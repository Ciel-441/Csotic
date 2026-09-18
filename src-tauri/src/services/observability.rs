use std::sync::Mutex;
use rusqlite::{Connection, params};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn redact_secrets(input: &str) -> String {
    let mut redacted = input.to_string();

    // 1. Redact common API key patterns (OpenAI, Anthropic, Groq, OpenRouter, GitHub, AWS, etc.)
    let patterns = [
        r"sk-ant-[a-zA-Z0-9_\-]{20,}",
        r"gsk_[a-zA-Z0-9_\-]{20,}",
        r"ghp_[a-zA-Z0-9]{36}",
        r"gho_[a-zA-Z0-9]{36}",
        r"AIza[0-9A-Za-z\-_]{35}",
        r"AKIA[0-9A-Z]{16}",
        r"sk-[a-zA-Z0-9_\-]{20,}",
    ];

    for pattern in &patterns {
        if let Ok(re) = regex_lite_or_replace(&mut redacted, pattern) {
            let _ = re;
        }
    }

    // 2. Redact Authorization headers, Bearer tokens, and key-value secret assignments
    let lines: Vec<String> = redacted.lines().map(|line| {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();
        if lower.contains("[redacted_") {
            line.to_string()
        } else if lower.starts_with("authorization:") || lower.starts_with("bearer ") || lower.starts_with("basic ") {
            "[REDACTED_AUTH_HEADER]".to_string()
        } else if lower.contains("password")
            || lower.contains("secret")
            || lower.contains("api_key")
            || lower.contains("apikey")
            || lower.contains("private_key")
            || lower.contains("auth_key")
            || lower.contains("access_token")
            || lower.contains("jwt")
            || lower.contains("token=")
            || lower.contains("token:")
            || lower.contains("token\":")
        {
            // If it looks like a key-value assignment (e.g. MY_INTERNAL_TOKEN=..., "apiKey": "...")
            if let Some(idx) = line.find('=') {
                format!("{}=[REDACTED_SECRET]", &line[..idx])
            } else if let Some(idx) = line.find(':') {
                format!("{}: \"[REDACTED_SECRET]\"", &line[..idx])
            } else {
                "[REDACTED_SECRET_LINE]".to_string()
            }
        } else {
            line.to_string()
        }
    }).collect();

    lines.join("\n")
}

fn regex_lite_or_replace(text: &mut String, prefix_type: &str) -> Result<(), ()> {
    let (prefix, label) = if prefix_type.starts_with("sk-ant-") {
        ("sk-ant-", "[REDACTED_ANTHROPIC_KEY]")
    } else if prefix_type.starts_with("gsk_") {
        ("gsk_", "[REDACTED_GROQ_KEY]")
    } else if prefix_type.starts_with("ghp_") {
        ("ghp_", "[REDACTED_GITHUB_TOKEN]")
    } else if prefix_type.starts_with("gho_") {
        ("gho_", "[REDACTED_GITHUB_OAUTH]")
    } else if prefix_type.starts_with("AIza") {
        ("AIza", "[REDACTED_GOOGLE_API_KEY]")
    } else if prefix_type.starts_with("AKIA") {
        ("AKIA", "[REDACTED_AWS_ACCESS_KEY]")
    } else if prefix_type.starts_with("sk-") {
        ("sk-", "[REDACTED_API_KEY]")
    } else {
        return Ok(());
    };

    while let Some(start) = text.find(prefix) {
        let end = text[start..].find(|c: char| c.is_whitespace() || c == '"' || c == '\'' || c == ',' || c == '\\' || c == '}' || c == '&')
            .map(|len| start + len)
            .unwrap_or(text.len());
        text.replace_range(start..end, label);
    }
    Ok(())
}

pub fn log_action(db: &Mutex<Connection>, session_id: &str, action_type: &str, payload: &str) {
    let Ok(conn) = db.lock() else { return };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();

    let safe_payload = redact_secrets(payload);
    
    let _ = conn.execute(
        "INSERT INTO action_logs (session_id, action_type, payload, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![session_id, action_type, safe_payload, now],
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_redact_api_keys() {
        let input = r#"{"apiKey": "sk-1234567890abcdef1234567890abcdef", "provider": "openai"}"#;
        let redacted = redact_secrets(input);
        assert!(!redacted.contains("sk-1234567890abcdef1234567890abcdef"));
        assert!(redacted.contains("[REDACTED_API_KEY]") || redacted.contains("[REDACTED_SECRET]"));

        let anthropic_input = "sk-ant-api03-abcdef1234567890abcdef1234567890";
        let ant_redacted = redact_secrets(anthropic_input);
        assert!(!ant_redacted.contains("sk-ant-api03-abcdef1234567890abcdef1234567890"));
        assert!(ant_redacted.contains("[REDACTED_ANTHROPIC_KEY]"));

        let github_input = "ghp_123456789012345678901234567890123456";
        let gh_redacted = redact_secrets(github_input);
        assert!(!gh_redacted.contains("ghp_123456789012345678901234567890123456"));
        assert!(gh_redacted.contains("[REDACTED_GITHUB_TOKEN]"));

        let google_input = "AIzaSyDa1234567890123456789012345678901";
        let g_redacted = redact_secrets(google_input);
        assert!(!g_redacted.contains("AIzaSyDa1234567890123456789012345678901"));
        assert!(g_redacted.contains("[REDACTED_GOOGLE_API_KEY]"));

        let aws_input = "AKIAIOSFODNN7EXAMPLE";
        let aws_redacted = redact_secrets(aws_input);
        assert!(!aws_redacted.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(aws_redacted.contains("[REDACTED_AWS_ACCESS_KEY]"));
    }

    #[test]
    fn test_redact_auth_headers() {
        let auth_input = "Authorization: Bearer supersecrettoken123456";
        let redacted = redact_secrets(auth_input);
        assert_eq!(redacted, "[REDACTED_AUTH_HEADER]");
    }

    #[test]
    fn test_redact_custom_internal_tokens() {
        let custom_token_input = "MY_INTERNAL_TOKEN=secret_value_xyz123";
        let redacted = redact_secrets(custom_token_input);
        assert_eq!(redacted, "MY_INTERNAL_TOKEN=[REDACTED_SECRET]");
        assert!(!redacted.contains("secret_value_xyz123"));
    }
}

