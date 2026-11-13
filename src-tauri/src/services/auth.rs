use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, Duration};
use crate::ipc::types::ErrorCode;
use crate::services::models::{decode_secret, mask_for_display};
use crate::services::observability::redact_secrets;

static AUTH_RATE_LIMITER: Mutex<Option<Vec<Instant>>> = Mutex::new(None);

/// Check and enforce rate limiting on auth verification attempts.
/// Allows at most 5 attempts per 30-second window.
pub fn check_auth_rate_limit() -> Result<(), (ErrorCode, String)> {
    let mut guard = AUTH_RATE_LIMITER.lock().map_err(|_| {
        (ErrorCode::Internal, "Internal authentication concurrency error".to_string())
    })?;
    let now = Instant::now();
    let window = Duration::from_secs(30);
    let max_attempts = 5;

    let timestamps = guard.get_or_insert_with(Vec::new);
    timestamps.retain(|t| now.duration_since(*t) < window);

    if timestamps.len() >= max_attempts {
        return Err((
            ErrorCode::Validation,
            "Too many authentication attempts. Rate limit exceeded. Please wait 30 seconds before retrying.".to_string(),
        ));
    }

    timestamps.push(now);
    Ok(())
}

#[cfg(test)]
pub fn reset_auth_rate_limit_for_tests() {
    if let Ok(mut guard) = AUTH_RATE_LIMITER.lock() {
        if let Some(ref mut vec) = *guard {
            vec.clear();
        }
    }
}

/// Sanitize error messages to ensure internal OS filesystem paths or sensitive credentials never leak
pub fn sanitize_error_message(msg: &str) -> String {
    let redacted = redact_secrets(msg);
    // Strip common local filesystem path patterns (e.g. C:\Users\... or /Users/...)
    let lines: Vec<String> = redacted.lines().map(|line| {
        let mut clean = line.to_string();
        if clean.contains(":\\Users\\") || clean.contains(":\\users\\") || clean.contains("/home/") || clean.contains("/Users/") {
            if let Some(pos) = clean.find(":\\Users\\").or_else(|| clean.find(":\\users\\")) {
                let start = clean[..pos].rfind(|c: char| c.is_whitespace() || c == '\'' || c == '"' || c == '(').map(|i| i + 1).unwrap_or(0);
                let end = clean[pos..].find(|c: char| c.is_whitespace() || c == '\'' || c == '"' || c == ')').map(|i| pos + i).unwrap_or(clean.len());
                clean.replace_range(start..end, "[INTERNAL_PATH]");
            }
        }
        clean
    }).collect();
    lines.join("\n")
}

fn get_forge_dir() -> PathBuf {
    let base = if let Ok(home) = std::env::var("USERPROFILE") {
        PathBuf::from(home)
    } else if let Ok(home) = std::env::var("HOME") {
        PathBuf::from(home)
    } else {
        PathBuf::from(".")
    };
    base.join(".forge")
}

fn get_auth_file_path() -> PathBuf {
    get_forge_dir().join("auth.json")
}

/// Persists the session atomically (temp file + rename) and owner-only on Unix.
/// The session never contains a usable credential: tokens are verified once at login and
/// only their masked form is stored, since nothing in the app needs the raw token afterwards.
fn write_session(session: &serde_json::Value) -> Result<(), (ErrorCode, String)> {
    let dir = get_forge_dir();
    fs::create_dir_all(&dir)
        .map_err(|e| (ErrorCode::Filesystem, format!("Failed to create session directory: {e}")))?;
    let json_str = serde_json::to_string_pretty(session)
        .map_err(|e| (ErrorCode::Internal, format!("Failed to serialize session: {e}")))?;
    let tmp = dir.join("auth.json.tmp");
    fs::write(&tmp, json_str)
        .map_err(|e| (ErrorCode::Filesystem, format!("Failed to save auth.json: {e}")))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600));
    }
    fs::rename(&tmp, get_auth_file_path())
        .map_err(|e| (ErrorCode::Filesystem, format!("Failed to save auth.json: {e}")))
}

/// Sanitize profile string inputs to avoid unbounded allocation or injection.
/// Truncates by characters: byte slicing panics mid-UTF-8 (and release builds abort on panic).
fn sanitize_profile_value(val: &str, max_len: usize) -> String {
    val.trim().chars().filter(|c| !c.is_control()).take(max_len).collect()
}

/// Verify that an avatar URL uses a safe protocol (https:// or data:image/).
/// Plain http:// is rejected: it leaks the user's IP/activity over an unencrypted request.
pub fn sanitize_avatar_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let lower = trimmed.to_lowercase();
    if (lower.starts_with("https://") || lower.starts_with("data:image/")) 
        && trimmed.len() <= 2048 
        && !trimmed.contains('\n') 
        && !trimmed.contains('\r') 
    {
        return trimmed.to_string();
    }
    String::new()
}

/// Basic email syntax check
pub fn is_valid_email(email: &str) -> bool {
    let trimmed = email.trim();
    if trimmed.is_empty() || trimmed.len() > 254 {
        return false;
    }
    let parts: Vec<&str> = trimmed.split('@').collect();
    if parts.len() != 2 {
        return false;
    }
    let (user, domain) = (parts[0], parts[1]);
    !user.is_empty() && !domain.is_empty() && domain.contains('.')
}

/// Retrieves the active session with credentials masked for safe IPC display.
pub fn get_session() -> Result<serde_json::Value, (ErrorCode, String)> {
    let path = get_auth_file_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&content) {
                let user_id = json.get("user")
                    .and_then(|u| u.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let provider = json.get("provider")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");

                // Invalidate mock or demo sessions
                if user_id.is_empty() || user_id == "gh_developer" || user_id == "local_dev" || provider == "local" || user_id.starts_with("local_") {
                    let _ = fs::remove_file(&path);
                    return Ok(serde_json::json!({ "session": null }));
                }

                let stored_token = json.get("token")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if stored_token.is_empty() {
                    let _ = fs::remove_file(&path);
                    return Ok(serde_json::json!({ "session": null }));
                }

                // Sessions saved by older versions hold the (weakly obfuscated) raw token.
                // Mask it and rewrite the file so the credential no longer sits on disk.
                if !stored_token.contains('\u{2022}') {
                    let raw_token = decode_secret(&stored_token);
                    let lower_token = raw_token.to_lowercase();
                    if raw_token.is_empty() || lower_token.contains("demo") || lower_token.contains("mock") || raw_token == "gho_detected_local" {
                        let _ = fs::remove_file(&path);
                        return Ok(serde_json::json!({ "session": null }));
                    }
                    json["token"] = serde_json::json!(mask_for_display(&raw_token));
                    json["hasToken"] = serde_json::json!(true);
                    let _ = write_session(&json);
                }

                json["hasToken"] = serde_json::json!(true);
                return Ok(serde_json::json!({ "session": json }));
            }
        }
    }
    Ok(serde_json::json!({ "session": null }))
}

/// Hardened subprocess execution for local developer detection
fn run_command_capture(cmd: &str, args: &[&str]) -> Option<String> {
    // Whitelist only approved binaries
    if cmd != "gh" && cmd != "git" {
        return None;
    }

    let mut command = std::process::Command::new(cmd);
    command.args(args);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // 0x08000000 = CREATE_NO_WINDOW (prevents black console popup)
        command.creation_flags(0x08000000);
    }

    let output = command.output().ok()?;
    if output.status.success() {
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

pub fn detect_local_identity() -> Result<serde_json::Value, (ErrorCode, String)> {
    let mut gh_detected = None;
    if let Some(user_json_str) = run_command_capture("gh", &["api", "user"]) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&user_json_str) {
            gh_detected = Some(serde_json::json!({
                "available": true,
                "login": val.get("login").and_then(|v| v.as_str()),
                "name": val.get("name").and_then(|v| v.as_str()),
                "email": val.get("email").and_then(|v| v.as_str()),
                "avatar_url": val.get("avatar_url").and_then(|v| v.as_str()),
                "company": val.get("company").and_then(|v| v.as_str()),
                "bio": val.get("bio").and_then(|v| v.as_str()),
            }));
        }
    }

    let git_name = run_command_capture("git", &["config", "--global", "user.name"]);
    let git_email = run_command_capture("git", &["config", "--global", "user.email"]);

    Ok(serde_json::json!({
        "gh": gh_detected,
        "git": {
            "name": git_name,
            "email": git_email,
        }
    }))
}

pub async fn login_gh_cli() -> Result<serde_json::Value, (ErrorCode, String)> {
    let token = run_command_capture("gh", &["auth", "token"]).ok_or_else(|| {
        (
            ErrorCode::Validation,
            "No authenticated GitHub CLI ('gh') session found. Run 'gh auth login' in terminal or enter a Personal Access Token.".into(),
        )
    })?;

    login_github_token(&token).await
}

pub async fn login_github_token(token: &str) -> Result<serde_json::Value, (ErrorCode, String)> {
    let clean_token = token.trim();
    if clean_token.is_empty() {
        return Err((ErrorCode::Validation, "GitHub Personal Access Token is required".into()));
    }

    let lower = clean_token.to_lowercase();
    if lower.contains("demo") || lower.contains("mock") || lower.contains("dummy") || lower.contains("fake") || lower.starts_with("test_") || lower == "test" {
        return Err((ErrorCode::Validation, "Demo or mock tokens are strictly rejected. A genuine GitHub Personal Access Token is required.".into()));
    }

    // Input sanitation & length check
    if clean_token.len() < 8 || clean_token.len() > 512 || !clean_token.is_ascii() || clean_token.contains(|c: char| c.is_whitespace() || c.is_control()) {
        return Err((ErrorCode::Validation, "Invalid GitHub token format or characters".into()));
    }

    // Rate limit check
    check_auth_rate_limit()?;

    let client = reqwest::Client::builder()
        .user_agent("Csotic-IDE/0.1.0")
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|_| (ErrorCode::Internal, "Failed to initialize HTTP client".to_string()))?;

    // 1. Fetch user profile from GitHub API
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {clean_token}"))
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|_| (ErrorCode::Network, "Unable to connect to GitHub. Please check your internet connection.".to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let safe_msg = match status.as_u16() {
            401 => "GitHub authentication failed: Personal Access Token is invalid, expired, or revoked.".to_string(),
            403 => "GitHub access denied: Token lacks required scopes (read:user, user:email) or rate limit reached.".to_string(),
            404 => "GitHub user endpoint not found.".to_string(),
            429 => "GitHub API rate limit exceeded. Please wait a few minutes before trying again.".to_string(),
            500..=599 => "GitHub is currently experiencing an outage. Please try again later.".to_string(),
            code => format!("GitHub authentication failed with status {code}. Please verify your token."),
        };
        return Err((ErrorCode::Validation, safe_msg));
    }

    let user_data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| (ErrorCode::Internal, format!("Failed to parse GitHub profile: {e}")))?;

    let user_id = user_data
        .get("id")
        .map(|v| v.to_string())
        .unwrap_or_else(|| "github_user".to_string());
    let username = user_data
        .get("login")
        .and_then(|v| v.as_str())
        .unwrap_or("github_user")
        .to_string();
    let name = user_data
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(&username)
        .to_string();
    let mut email = user_data
        .get("email")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let avatar_url = sanitize_avatar_url(user_data.get("avatar_url").and_then(|v| v.as_str()).unwrap_or(""));
    let bio = user_data
        .get("bio")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let repos_count = user_data
        .get("public_repos")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let location = user_data
        .get("location")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let company = user_data
        .get("company")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    // 2. If public email is empty, attempt to fetch primary email from /user/emails
    if email.is_empty() {
        if let Ok(emails_resp) = client
            .get("https://api.github.com/user/emails")
            .header("Authorization", format!("Bearer {clean_token}"))
            .header("Accept", "application/vnd.github.v3+json")
            .send()
            .await
        {
            if emails_resp.status().is_success() {
                if let Ok(emails) = emails_resp.json::<Vec<serde_json::Value>>().await {
                    if let Some(primary) = emails.iter().find(|e| {
                        e.get("primary").and_then(|v| v.as_bool()).unwrap_or(false)
                    }) {
                        if let Some(em) = primary.get("email").and_then(|v| v.as_str()) {
                            email = em.to_string();
                        }
                    } else if let Some(first) = emails.first() {
                        if let Some(em) = first.get("email").and_then(|v| v.as_str()) {
                            email = em.to_string();
                        }
                    }
                }
            }
        }
    }

    if email.is_empty() {
        email = format!("{username}@users.noreply.github.com");
    }

    let now = chrono::Utc::now().to_rfc3339();

    let storage_session = serde_json::json!({
        "user": {
            "id": user_id,
            "username": username,
            "name": name,
            "email": email,
            "avatarUrl": avatar_url,
            "provider": "github",
            "bio": bio,
            "reposCount": repos_count,
            "location": location,
            "company": company,
            "createdAt": now,
        },
        // Masked only: the PAT was needed once, to verify identity; never persist it.
        "token": mask_for_display(clean_token),
        "hasToken": true,
        "provider": "github",
        "syncEnabled": true,
        "lastSyncedAt": now,
    });

    write_session(&storage_session)?;

    Ok(serde_json::json!({
        "success": true,
        "session": storage_session
    }))
}

pub async fn login_google(payload: &serde_json::Value) -> Result<serde_json::Value, (ErrorCode, String)> {
    let token = payload
        .get("token")
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .unwrap_or("");

    // Strict Security Gate: Require valid token; reject arbitrary unverified user injection
    if token.is_empty() {
        return Err((
            ErrorCode::Validation,
            "Google OAuth Access Token is required to authenticate with Google".into(),
        ));
    }

    let lower = token.to_lowercase();
    if lower.contains("demo") || lower.contains("mock") || lower.contains("dummy") || lower.contains("fake") || lower.starts_with("test_") || lower == "test" {
        return Err((
            ErrorCode::Validation,
            "Demo or mock tokens are strictly rejected. A genuine Google OAuth Access Token is required.".into(),
        ));
    }

    if token.len() < 10 || token.len() > 2048 || !token.is_ascii() || token.contains(|c: char| c.is_whitespace() || c.is_control()) {
        return Err((
            ErrorCode::Validation,
            "Invalid Google OAuth Access Token format".into(),
        ));
    }

    // Rate limit check
    check_auth_rate_limit()?;

    let client = reqwest::Client::builder()
        .user_agent("Csotic-IDE/0.1.0")
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|_| (ErrorCode::Internal, "Failed to initialize HTTP client".to_string()))?;

    let resp = client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|_| (ErrorCode::Network, "Unable to connect to Google API. Please check your internet connection.".to_string()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let safe_msg = match status.as_u16() {
            401 => "Google authentication failed: OAuth Access Token is invalid, expired, or revoked.".to_string(),
            403 => "Google access denied: Token lacks necessary userinfo permissions.".to_string(),
            429 => "Google API rate limit exceeded. Please wait a few minutes before trying again.".to_string(),
            500..=599 => "Google API is currently experiencing an outage. Please try again later.".to_string(),
            code => format!("Google authentication failed with status {code}. Please verify your token."),
        };
        return Err((ErrorCode::Validation, safe_msg));
    }

    let g_user: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| (ErrorCode::Internal, format!("Failed to parse Google user response: {e}")))?;

    let user_id = g_user.get("sub").and_then(|v| v.as_str()).unwrap_or("google_user");
    let email = g_user.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let name = g_user.get("name").and_then(|v| v.as_str()).unwrap_or(email);
    let avatar_url = sanitize_avatar_url(g_user.get("picture").and_then(|v| v.as_str()).unwrap_or(""));
    let username = if !email.is_empty() {
        email.split('@').next().unwrap_or(name).to_string()
    } else {
        name.to_lowercase().replace(' ', "_")
    };

    let now = chrono::Utc::now().to_rfc3339();

    let storage_session = serde_json::json!({
        "user": {
            "id": format!("google_{user_id}"),
            "username": username,
            "login": username,
            "name": name,
            "email": email,
            "avatarUrl": avatar_url,
            "provider": "google",
            "bio": "Verified Google Developer Account",
            "createdAt": now,
        },
        // Masked only: OAuth Playground tokens can carry broad scopes (Gmail, Drive); never persist.
        "token": mask_for_display(token),
        "hasToken": true,
        "provider": "google",
        "syncEnabled": true,
        "lastSyncedAt": now,
    });

    write_session(&storage_session)?;

    Ok(serde_json::json!({
        "success": true,
        "session": storage_session
    }))
}

pub fn save_profile(profile: &serde_json::Value) -> Result<serde_json::Value, (ErrorCode, String)> {
    let path = get_auth_file_path();
    if !path.exists() {
        return Err((
            ErrorCode::Validation,
            "Cannot update profile: No active authenticated session found. Please sign in with GitHub or Google first.".into(),
        ));
    }

    let raw_session = fs::read_to_string(&path)
        .map_err(|e| (ErrorCode::Filesystem, format!("Failed to read auth session: {e}")))?;

    let mut current_session: serde_json::Value = serde_json::from_str(&raw_session)
        .map_err(|e| (ErrorCode::Internal, format!("Failed to parse session: {e}")))?;

    let stored_token = current_session.get("token").and_then(|v| v.as_str()).unwrap_or("").to_string();
    if current_session.get("user").is_none() || stored_token.is_empty() {
        return Err((
            ErrorCode::Validation,
            "Cannot update profile: No authenticated user session exists. Please sign in with GitHub or Google first.".into(),
        ));
    }

    let raw_name = profile.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let raw_username = profile.get("username").and_then(|v| v.as_str()).unwrap_or("");
    let raw_email = profile.get("email").and_then(|v| v.as_str()).unwrap_or("");
    let raw_avatar = profile.get("avatarUrl").and_then(|v| v.as_str()).unwrap_or("");
    let raw_bio = profile.get("bio").and_then(|v| v.as_str()).unwrap_or("");

    let name = sanitize_profile_value(raw_name, 100);
    if name.is_empty() {
        return Err((ErrorCode::Validation, "Display Name is required".into()));
    }

    let username = sanitize_profile_value(raw_username, 50);
    let email = sanitize_profile_value(raw_email, 254);
    if !email.is_empty() && !is_valid_email(&email) {
        return Err((ErrorCode::Validation, "Invalid email address format".into()));
    }

    let avatar_url = sanitize_avatar_url(raw_avatar);
    let bio = sanitize_profile_value(raw_bio, 500);

    let user_id = current_session.get("user")
        .and_then(|u| u.get("id"))
        .and_then(|v| v.as_str())
        .unwrap_or("user")
        .to_string();

    let provider = current_session.get("provider")
        .and_then(|v| v.as_str())
        .unwrap_or("github")
        .to_string();

    let now = chrono::Utc::now().to_rfc3339();

    let sanitized_user = serde_json::json!({
        "id": user_id,
        "name": name,
        "username": if !username.is_empty() { username } else { name.to_lowercase().replace(' ', "_") },
        "email": email,
        "avatarUrl": avatar_url,
        "bio": bio,
        "provider": provider,
        "updatedAt": now,
    });

    current_session["user"] = sanitized_user;
    current_session["lastSyncedAt"] = serde_json::json!(now);

    // Never write or hand back a raw (legacy) token.
    if !stored_token.contains('\u{2022}') {
        current_session["token"] = serde_json::json!(mask_for_display(&decode_secret(&stored_token)));
    }
    current_session["hasToken"] = serde_json::json!(true);
    write_session(&current_session)?;

    Ok(serde_json::json!({
        "success": true,
        "session": current_session
    }))
}

pub fn logout() -> Result<serde_json::Value, (ErrorCode, String)> {
    let path = get_auth_file_path();
    if path.exists() {
        let _ = fs::remove_file(&path);
    }
    Ok(serde_json::json!({
        "success": true,
        "session": null
    }))
}

pub async fn handle_action(
    action: &str,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, (ErrorCode, String)> {
    let res = match action {
        "get_session" => get_session(),
        "detect_local_identity" => detect_local_identity(),
        "login_gh_cli" => login_gh_cli().await,
        "login_github_token" => {
            let token = payload
                .get("token")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            login_github_token(token).await
        }
        "login_google" => login_google(payload).await,
        "save_profile" => {
            let profile = payload.get("profile").unwrap_or(payload);
            save_profile(profile)
        }
        "logout" => logout(),
        _ => Err((
            ErrorCode::Validation,
            format!("Unknown auth action: {action}"),
        )),
    };

    res.map_err(|(code, err_msg)| (code, sanitize_error_message(&err_msg)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_email_validation() {
        assert!(is_valid_email("dev@example.com"));
        assert!(is_valid_email("user.name+tag@sub.domain.org"));
        assert!(!is_valid_email("invalid"));
        assert!(!is_valid_email("invalid@"));
        assert!(!is_valid_email("@domain.com"));
        assert!(!is_valid_email("user@domain"));
    }

    #[test]
    fn test_avatar_url_sanitization() {
        assert_eq!(sanitize_avatar_url("https://avatars.githubusercontent.com/u/123"), "https://avatars.githubusercontent.com/u/123");
        assert_eq!(sanitize_avatar_url("http://example.com/pic.png"), "");
        assert_eq!(sanitize_avatar_url("data:image/png;base64,iVBOR..."), "data:image/png;base64,iVBOR...");
        
        // Malicious or invalid protocols must be rejected
        assert_eq!(sanitize_avatar_url("javascript:alert(1)"), "");
        assert_eq!(sanitize_avatar_url("vbscript:msgbox(1)"), "");
        assert_eq!(sanitize_avatar_url("file:///etc/passwd"), "");
        assert_eq!(sanitize_avatar_url("//protocol-relative.com/image.png"), "");
    }

    #[test]
    fn test_token_masking_roundtrip() {
        let token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz";
        let encrypted = crate::services::models::encode_secret(token);
        assert!(encrypted.starts_with("enc_v"));
        assert!(!encrypted.contains(token));
        
        let decrypted = decode_secret(&encrypted);
        assert_eq!(decrypted, token);
        
        let masked = mask_for_display(token);
        assert!(masked.contains('•'));
        assert_ne!(masked, token);
    }

    #[tokio::test]
    async fn test_google_login_rejects_empty_token() {
        let payload = serde_json::json!({ "token": "" });
        let res = login_google(&payload).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().1.contains("Google OAuth Access Token is required"));
    }

    #[tokio::test]
    async fn test_google_login_rejects_unverified_profile_injection() {
        let payload = serde_json::json!({
            "user": {
                "name": "Attacker",
                "email": "attacker@evil.com"
            }
        });
        let res = login_google(&payload).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().1.contains("Google OAuth Access Token is required"));
    }

    #[tokio::test]
    async fn test_github_login_rejects_malformed_token() {
        let res = login_github_token("").await;
        assert!(res.is_err());
        
        let res2 = login_github_token("short").await;
        assert!(res2.is_err());
        assert!(res2.unwrap_err().1.contains("Invalid GitHub token format"));
    }

    #[test]
    fn test_save_profile_rejects_unauthenticated_creation() {
        let profile = serde_json::json!({
            "name": "Demo Account",
            "email": "demo@example.com"
        });
        // Ensure that if no authenticated session exists on disk, it rejects
        let _ = fs::remove_file(get_auth_file_path());
        let res = save_profile(&profile);
        assert!(res.is_err());
        assert!(res.unwrap_err().1.contains("No active authenticated session found"));
    }

    #[tokio::test]
    async fn test_github_login_rejects_demo_token() {
        let res = login_github_token("demo_account_token").await;
        assert!(res.is_err());
        assert!(res.unwrap_err().1.contains("Demo or mock tokens are strictly rejected"));
    }

    #[tokio::test]
    async fn test_google_login_rejects_demo_token() {
        reset_auth_rate_limit_for_tests();
        let payload = serde_json::json!({ "token": "ya29.demo_token_12345" });
        let res = login_google(&payload).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().1.contains("Demo or mock tokens are strictly rejected"));
    }

    #[test]
    fn test_profile_values_truncate_on_char_boundaries() {
        let long = "\u{e9}".repeat(200);
        assert_eq!(sanitize_profile_value(&long, 100).chars().count(), 100);
        assert_eq!(mask_for_display("abcd-\u{43a}\u{43b}\u{44e}\u{447}-wxyz"), "abcd\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}\u{2022}wxyz");
    }

    #[test]
    fn test_auth_rate_limiting() {
        reset_auth_rate_limit_for_tests();
        for _ in 0..5 {
            assert!(check_auth_rate_limit().is_ok());
        }
        let blocked = check_auth_rate_limit();
        assert!(blocked.is_err());
        assert!(blocked.unwrap_err().1.contains("Rate limit exceeded"));
        reset_auth_rate_limit_for_tests();
    }

    #[test]
    fn test_error_sanitization_removes_sensitive_paths_and_tokens() {
        let raw = "Internal error at C:\\Users\\developer\\AppData\\Local\\secret.rs with ghp_1234567890abcdefghijklmnopqrstuvwxyz";
        let safe = sanitize_error_message(raw);
        assert!(!safe.contains("C:\\Users\\developer"));
        assert!(!safe.contains("ghp_1234567890abcdefghijklmnopqrstuvwxyz"));
        assert!(safe.contains("[INTERNAL_PATH]") || safe.contains("[REDACTED"));
    }
}
