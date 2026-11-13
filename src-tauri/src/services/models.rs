use crate::events::{emit_model_stream, ModelStreamEvent};
use crate::ollama::client::OllamaClient;
use crate::ollama::types::*;
use futures_util::StreamExt;
use rusqlite::Connection;
use std::sync::Mutex;
use tauri::AppHandle;

fn get_device_salt() -> Vec<u8> {
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "forge_device_entropy".to_string());
    let user = std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "forge_user".to_string());
    let raw = format!("{}:{}:forge_v1_secure_storage", hostname, user);
    crate::services::filesystem::compute_sha256(&raw).into_bytes()
}

/// Windows DPAPI: real encryption keyed to the logged-in Windows account. Another user, another
/// machine, or a copied auth.json / forge.db cannot decrypt it (unlike the old XOR "enc_v1").
#[cfg(windows)]
mod dpapi {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    fn run(input: &[u8], protect: bool) -> Option<Vec<u8>> {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: input.len() as u32,
            pbData: input.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB {
            cbData: 0,
            pbData: std::ptr::null_mut(),
        };
        // SAFETY: in_blob points at `input` for the duration of the call; on success the OS
        // allocates out_blob.pbData with LocalAlloc, which we copy and then LocalFree exactly once.
        unsafe {
            let ok = if protect {
                CryptProtectData(
                    &in_blob,
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut out_blob,
                )
            } else {
                CryptUnprotectData(
                    &in_blob,
                    std::ptr::null_mut(),
                    std::ptr::null(),
                    std::ptr::null(),
                    std::ptr::null(),
                    CRYPTPROTECT_UI_FORBIDDEN,
                    &mut out_blob,
                )
            };
            if ok == 0 || out_blob.pbData.is_null() {
                return None;
            }
            let bytes =
                std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec();
            LocalFree(out_blob.pbData as _);
            Some(bytes)
        }
    }

    pub fn protect(data: &[u8]) -> Option<Vec<u8>> {
        run(data, true)
    }

    pub fn unprotect(data: &[u8]) -> Option<Vec<u8>> {
        run(data, false)
    }
}

pub fn encode_secret(key: &str) -> String {
    if key.trim().is_empty() {
        return String::new();
    }
    use base64::Engine;
    #[cfg(windows)]
    if let Some(sealed) = dpapi::protect(key.as_bytes()) {
        return format!(
            "enc_v2:{}",
            base64::engine::general_purpose::STANDARD.encode(sealed)
        );
    }
    // ponytail: non-Windows still uses device-salted XOR (obfuscation, not encryption);
    // switch to the OS keychain (keyring crate) when Linux/macOS builds ship.
    let salt = get_device_salt();
    let key_bytes = key.as_bytes();
    let mut obfuscated = Vec::with_capacity(key_bytes.len());
    for (i, &b) in key_bytes.iter().enumerate() {
        obfuscated.push(b ^ salt[i % salt.len()]);
    }
    format!(
        "enc_v1:{}",
        base64::engine::general_purpose::STANDARD.encode(&obfuscated)
    )
}

/// True when a stored secret should be re-saved with the current (stronger) format.
pub fn needs_reencode(stored: &str) -> bool {
    cfg!(windows) && !stored.trim().is_empty() && !stored.trim().starts_with("enc_v2:")
}

pub fn decode_secret(stored: &str) -> String {
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    use base64::Engine;
    #[cfg(windows)]
    if let Some(enc_payload) = trimmed.strip_prefix("enc_v2:") {
        return base64::engine::general_purpose::STANDARD
            .decode(enc_payload)
            .ok()
            .and_then(|bytes| dpapi::unprotect(&bytes))
            .and_then(|plain| String::from_utf8(plain).ok())
            .unwrap_or_default();
    }
    if let Some(enc_payload) = trimmed.strip_prefix("enc_v1:") {
        if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(enc_payload) {
            let salt = get_device_salt();
            let mut deobfuscated = Vec::with_capacity(bytes.len());
            for (i, &b) in bytes.iter().enumerate() {
                deobfuscated.push(b ^ salt[i % salt.len()]);
            }
            if let Ok(s) = String::from_utf8(deobfuscated) {
                return s;
            }
        }
    }
    // Backward compatibility for old base64 "__FORGE_SEC_" format
    if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(trimmed) {
        if let Ok(decoded) = String::from_utf8(bytes) {
            if let Some(rest) = decoded.strip_prefix("__FORGE_SEC_") {
                if let Some(clean) = rest.strip_suffix("__") {
                    return clean.to_string();
                }
            }
        }
    }
    // Plaintext fallback
    trimmed.to_string()
}

pub fn mask_for_display(key: &str) -> String {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    // Char-based, not byte slicing: a non-ASCII key must not panic (release builds abort on panic).
    let chars: Vec<char> = trimmed.chars().collect();
    if chars.len() <= 8 {
        return "••••••••".to_string();
    }
    let prefix: String = chars[..4].iter().collect();
    let suffix: String = chars[chars.len() - 4..].iter().collect();
    format!("{}••••••••{}", prefix, suffix)
}

pub fn get_api_key(db: &Mutex<Connection>, provider: &str) -> Option<String> {
    let stored: String = {
        let conn = db.lock().ok()?;
        conn.query_row(
            "SELECT key_value FROM api_keys WHERE provider = ?1",
            rusqlite::params![provider],
            |row| row.get(0),
        )
        .ok()?
    };
    let key = decode_secret(&stored);
    let key = key.trim();
    if key.is_empty() {
        return None;
    }
    // Upgrade keys saved in an older, weaker format (lock is released above, so no deadlock).
    if needs_reencode(&stored) {
        let _ = save_api_key(db, provider, key);
    }
    Some(key.to_string())
}

pub fn save_api_key(db: &Mutex<Connection>, provider: &str, key: &str) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let _ = conn.execute(
            "DELETE FROM api_keys WHERE provider = ?1",
            rusqlite::params![provider],
        );
        return Ok(());
    }
    // Do not overwrite existing secret if the frontend simply returned the masked placeholder
    if trimmed.contains('•') || trimmed.contains("****") {
        return Ok(());
    }

    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    let encoded = encode_secret(trimmed);
    conn.execute(
        "INSERT OR REPLACE INTO api_keys (provider, key_value, updated_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![provider, encoded, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn handle(
    action: &str,
    payload: &serde_json::Value,
    app: &AppHandle,
    db: &Mutex<Connection>,
) -> Result<serde_json::Value, String> {
    let client = OllamaClient::new(None);

    match action {
        "get_api_keys" => {
            let providers = [
                "openai",
                "anthropic",
                "deepseek",
                "groq",
                "openrouter",
                "gemini",
                "custom_endpoints",
            ];
            let mut map = serde_json::Map::new();
            for p in providers {
                if let Some(real_key) = get_api_key(db, p) {
                    if p == "custom_endpoints" {
                        if let Ok(mut arr) =
                            serde_json::from_str::<Vec<serde_json::Value>>(&real_key)
                        {
                            for item in &mut arr {
                                if let Some(k) = item.get("api_key").and_then(|v| v.as_str()) {
                                    item["api_key"] =
                                        serde_json::Value::String(mask_for_display(k));
                                }
                            }
                            map.insert(
                                p.to_string(),
                                serde_json::Value::String(
                                    serde_json::to_string(&arr).unwrap_or_default(),
                                ),
                            );
                            continue;
                        }
                    }
                    map.insert(
                        p.to_string(),
                        serde_json::Value::String(mask_for_display(&real_key)),
                    );
                } else {
                    map.insert(p.to_string(), serde_json::Value::String(String::new()));
                }
            }

            Ok(serde_json::Value::Object(map))
        }
        "save_api_keys" => {
            let providers = [
                "openai",
                "anthropic",
                "deepseek",
                "groq",
                "openrouter",
                "gemini",
            ];
            for p in providers {
                if let Some(val) = payload.get(p).and_then(|v| v.as_str()) {
                    let _ = save_api_key(db, p, val);
                }
            }
            if let Some(custom_val) = payload.get("custom_endpoints").and_then(|v| v.as_str()) {
                if custom_val.trim().is_empty() || custom_val.trim() == "[]" {
                    let _ = save_api_key(db, "custom_endpoints", "");
                } else if let Ok(mut new_arr) =
                    serde_json::from_str::<Vec<serde_json::Value>>(custom_val)
                {
                    let existing_endpoints = get_api_key(db, "custom_endpoints")
                        .and_then(|raw| serde_json::from_str::<Vec<serde_json::Value>>(&raw).ok())
                        .unwrap_or_default();

                    for item in &mut new_arr {
                        if let Some(k) = item.get("api_key").and_then(|v| v.as_str()) {
                            if k.contains('•') || k.contains("****") {
                                let model_id = item
                                    .get("model_id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or_default();
                                if let Some(old_ep) = existing_endpoints.iter().find(|e| {
                                    e.get("model_id").and_then(|v| v.as_str()) == Some(model_id)
                                }) {
                                    if let Some(old_k) =
                                        old_ep.get("api_key").and_then(|v| v.as_str())
                                    {
                                        item["api_key"] =
                                            serde_json::Value::String(old_k.to_string());
                                    }
                                }
                            }
                        }
                    }
                    let merged =
                        serde_json::to_string(&new_arr).unwrap_or_else(|_| custom_val.to_string());
                    let _ = save_api_key(db, "custom_endpoints", &merged);
                }
            }
            Ok(serde_json::json!({ "saved": true }))
        }
        "discover_models" => {
            let mut models: Vec<serde_json::Value> = Vec::new();

            // 1. Ollama local models
            if let Ok(tags) = client.tags().await {
                for m in tags.models.unwrap_or_default() {
                    let name = m.name.clone();
                    let (ctx, supports_vision) = match client.show(&name).await {
                        Ok(show_resp) => {
                            let ctx = show_resp
                                .parameters
                                .as_deref()
                                .and_then(|params| {
                                    for line in params.lines() {
                                        let line = line.trim();
                                        if line.starts_with("num_ctx") {
                                            return line
                                                .split_whitespace()
                                                .last()
                                                .and_then(|v| v.parse::<u32>().ok());
                                        }
                                    }
                                    None
                                })
                                .unwrap_or(8192u32);

                            let has_vision = show_resp
                                .modelinfo
                                .as_ref()
                                .map(|info| {
                                    let info_str = info.to_string().to_lowercase();
                                    info_str.contains("vision")
                                        || info_str.contains("llava")
                                        || info_str.contains("clip")
                                })
                                .unwrap_or(false)
                                || show_resp
                                    .details
                                    .as_ref()
                                    .and_then(|d| d.family.as_deref())
                                    .map(|f| {
                                        f.to_lowercase().contains("llava")
                                            || f.to_lowercase().contains("clip")
                                    })
                                    .unwrap_or(false);

                            (ctx, has_vision)
                        }
                        Err(_) => (8192u32, false),
                    };

                    models.push(serde_json::json!({
                        "id": name,
                        "name": name,
                        "provider": "ollama",
                        "version": m.details.as_ref().and_then(|d| d.parameter_size.clone()).unwrap_or_default(),
                        "context_window": ctx,
                        "supports_vision": supports_vision,
                        "is_free": true,
                        "has_api_key": true,
                        "status": "available",
                    }));
                }
            }

            // 2. OpenRouter models (Curated free & flagship models + live fetched models if API key present)
            let openrouter_key = get_api_key(db, "openrouter");
            let has_openrouter_key = openrouter_key.is_some();
            let mut existing_ids = std::collections::HashSet::new();

            // Live fetch only if API key is present; otherwise use the instant built-in static catalog
            let mut live_models = Vec::new();
            if let Some(ref api_key) = openrouter_key {
                if let Ok(fetched) = fetch_openrouter_models(api_key).await {
                    live_models = fetched;
                }
            }

            if !live_models.is_empty() {
                for mut m in live_models {
                    if let Some(id) = m["id"].as_str() {
                        if !existing_ids.contains(id) {
                            existing_ids.insert(id.to_string());
                            m["has_api_key"] = serde_json::json!(has_openrouter_key);
                            models.push(m);
                        }
                    }
                }
            } else {
                let openrouter_catalog = vec![
                    // --- Verified Active Free Models ---
                    (
                        "openrouter/free",
                        "OpenRouter Auto Free Router [FREE]",
                        128000,
                        true,
                        true,
                    ),
                    (
                        "meta-llama/llama-3.3-70b-instruct:free",
                        "Meta LLaMA 3.3 70B [FREE]",
                        128000,
                        false,
                        true,
                    ),
                    (
                        "deepseek/deepseek-chat:free",
                        "DeepSeek V3 Chat [FREE]",
                        128000,
                        false,
                        true,
                    ),
                    (
                        "deepseek/deepseek-r1:free",
                        "DeepSeek R1 Reasoning [FREE]",
                        128000,
                        false,
                        true,
                    ),
                    (
                        "google/gemini-2.0-flash-exp:free",
                        "Gemini 2.0 Flash Exp [FREE]",
                        1000000,
                        true,
                        true,
                    ),
                    (
                        "google/gemini-2.0-flash-thinking-exp:free",
                        "Gemini 2.0 Thinking [FREE]",
                        1000000,
                        true,
                        true,
                    ),
                    (
                        "meta-llama/llama-3.2-3b-instruct:free",
                        "Meta LLaMA 3.2 3B [FREE]",
                        128000,
                        false,
                        true,
                    ),
                    (
                        "meta-llama/llama-3.2-1b-instruct:free",
                        "Meta LLaMA 3.2 1B [FREE]",
                        128000,
                        false,
                        true,
                    ),
                    (
                        "deepseek/deepseek-r1-distill-llama-70b:free",
                        "DeepSeek R1 Distill 70B [FREE]",
                        128000,
                        false,
                        true,
                    ),
                    (
                        "deepseek/deepseek-r1-distill-qwen-32b:free",
                        "DeepSeek R1 Distill Qwen 32B [FREE]",
                        32768,
                        false,
                        true,
                    ),
                    // --- Anthropic Claude Models (OpenRouter) ---
                    (
                        "anthropic/claude-3.7-sonnet",
                        "Claude 3.7 Sonnet (Hybrid Reasoning)",
                        200000,
                        true,
                        false,
                    ),
                    (
                        "anthropic/claude-3.5-sonnet",
                        "Claude 3.5 Sonnet",
                        200000,
                        true,
                        false,
                    ),
                    (
                        "anthropic/claude-3.5-haiku",
                        "Claude 3.5 Haiku",
                        200000,
                        false,
                        false,
                    ),
                    (
                        "anthropic/claude-3-opus",
                        "Claude 3 Opus",
                        200000,
                        true,
                        false,
                    ),
                    // --- OpenAI Models (OpenRouter) ---
                    ("openai/gpt-4o", "OpenAI GPT-4o", 128000, true, false),
                    (
                        "openai/gpt-4o-mini",
                        "OpenAI GPT-4o Mini",
                        128000,
                        true,
                        false,
                    ),
                    (
                        "openai/o3-mini",
                        "OpenAI o3-mini Reasoning",
                        200000,
                        false,
                        false,
                    ),
                    ("openai/o1", "OpenAI o1 Reasoning", 200000, true, false),
                    ("openai/o1-mini", "OpenAI o1 Mini", 128000, false, false),
                    (
                        "openai/gpt-4-turbo",
                        "OpenAI GPT-4 Turbo",
                        128000,
                        true,
                        false,
                    ),
                    // --- DeepSeek Models (OpenRouter) ---
                    (
                        "deepseek/deepseek-chat",
                        "DeepSeek V3 Chat",
                        64000,
                        false,
                        false,
                    ),
                    (
                        "deepseek/deepseek-r1",
                        "DeepSeek R1 Reasoning",
                        64000,
                        false,
                        false,
                    ),
                    // --- xAI Grok Models (OpenRouter) ---
                    ("x-ai/grok-2", "xAI Grok 2", 128000, false, false),
                    (
                        "x-ai/grok-2-vision",
                        "xAI Grok 2 Vision",
                        32768,
                        true,
                        false,
                    ),
                    ("x-ai/grok-beta", "xAI Grok Beta", 128000, false, false),
                    // --- Mistral AI Models (OpenRouter) ---
                    (
                        "mistralai/mistral-large-2411",
                        "Mistral Large 2",
                        128000,
                        false,
                        false,
                    ),
                    (
                        "mistralai/codestral-2501",
                        "Mistral Codestral 2501",
                        256000,
                        false,
                        false,
                    ),
                    (
                        "mistralai/pixtral-large-2411",
                        "Mistral Pixtral Large",
                        128000,
                        true,
                        false,
                    ),
                    (
                        "mistralai/mistral-nemo",
                        "Mistral NeMo 12B",
                        128000,
                        false,
                        false,
                    ),
                    // --- Alibaba Qwen Models (OpenRouter) ---
                    (
                        "qwen/qwen-2.5-coder-32b-instruct",
                        "Qwen 2.5 Coder 32B",
                        32768,
                        false,
                        false,
                    ),
                    (
                        "qwen/qwen-2.5-72b-instruct",
                        "Qwen 2.5 72B",
                        128000,
                        false,
                        false,
                    ),
                    (
                        "qwen/qwq-32b-preview",
                        "Qwen QwQ 32B Reasoning",
                        32768,
                        false,
                        false,
                    ),
                    // --- Meta LLaMA Models (OpenRouter) ---
                    (
                        "meta-llama/llama-3.3-70b-instruct",
                        "Meta LLaMA 3.3 70B",
                        128000,
                        false,
                        false,
                    ),
                    (
                        "meta-llama/llama-3.1-405b-instruct",
                        "Meta LLaMA 3.1 405B Flagship",
                        128000,
                        false,
                        false,
                    ),
                    (
                        "meta-llama/llama-3.2-90b-vision-instruct",
                        "Meta LLaMA 3.2 90B Vision",
                        128000,
                        true,
                        false,
                    ),
                    // --- Cohere & Microsoft & Perplexity (OpenRouter) ---
                    (
                        "cohere/command-r-plus-08-2024",
                        "Cohere Command R+",
                        128000,
                        false,
                        false,
                    ),
                    (
                        "cohere/command-r-08-2024",
                        "Cohere Command R",
                        128000,
                        false,
                        false,
                    ),
                    ("microsoft/phi-4", "Microsoft Phi-4", 16384, false, false),
                    (
                        "microsoft/wizardlm-2-8x22b",
                        "Microsoft WizardLM 2 8x22B",
                        65536,
                        false,
                        false,
                    ),
                    (
                        "perplexity/sonar-reasoning",
                        "Perplexity Sonar Reasoning",
                        128000,
                        false,
                        false,
                    ),
                    (
                        "perplexity/sonar",
                        "Perplexity Sonar Search",
                        128000,
                        false,
                        false,
                    ),
                    // --- Stealth & Frontier Community Models (OpenRouter) ---
                    (
                        "stealth/ox-alpha:free",
                        "Stealth OX Alpha [FREE]",
                        128000,
                        false,
                        true,
                    ),
                    ("stealth/ox-alpha", "Stealth OX Alpha", 128000, false, false),
                    (
                        "nvidia/llama-3.1-nemotron-70b-instruct",
                        "NVIDIA Nemotron 70B",
                        128000,
                        false,
                        false,
                    ),
                ];

                for (id, name, ctx, vision, is_free) in openrouter_catalog {
                    existing_ids.insert(id.to_string());
                    models.push(serde_json::json!({
                        "id": id,
                        "name": name,
                        "provider": "openrouter",
                        "version": if is_free { "Free Cloud Model" } else { "OpenRouter Cloud API" },
                        "context_window": ctx,
                        "supports_vision": vision,
                        "is_free": is_free,
                        "has_api_key": has_openrouter_key,
                        "status": "available",
                    }));
                }
            }

            // Check which keys are configured
            let gemini_key = get_api_key(db, "gemini");
            let has_gemini_key = gemini_key.is_some();

            let groq_key = get_api_key(db, "groq");

            let openai_key = get_api_key(db, "openai");
            let anthropic_key = get_api_key(db, "anthropic");

            let deepseek_key = get_api_key(db, "deepseek");
            let has_deepseek_key = deepseek_key.is_some();

            // 3. Google Gemini models (only if Gemini API key configured)
            if has_gemini_key {
                let gemini_catalog = vec![
                    (
                        "gemini-2.0-flash",
                        "Google Gemini 2.0 Flash [FREE TIER]",
                        1000000,
                        true,
                    ),
                    (
                        "gemini-2.0-flash-thinking-exp",
                        "Google Gemini 2.0 Thinking [FREE TIER]",
                        1000000,
                        true,
                    ),
                    (
                        "gemini-2.0-pro-exp",
                        "Google Gemini 2.0 Pro Exp [FREE TIER]",
                        2000000,
                        true,
                    ),
                    (
                        "gemini-1.5-flash",
                        "Google Gemini 1.5 Flash [FREE TIER]",
                        1000000,
                        true,
                    ),
                    (
                        "gemini-1.5-pro",
                        "Google Gemini 1.5 Pro [FREE TIER]",
                        2000000,
                        true,
                    ),
                ];
                for (id, name, ctx, vision) in gemini_catalog {
                    models.push(serde_json::json!({
                        "id": id,
                        "name": name,
                        "provider": "gemini",
                        "version": "Google AI Studio",
                        "context_window": ctx,
                        "supports_vision": vision,
                        "is_free": true,
                        "has_api_key": true,
                        "status": "available",
                    }));
                }
            }

            // 4. Groq models (only if Groq API key configured)
            if let Some(ref api_key) = groq_key {
                let mut groq_added = false;
                if let Ok(fetched) = fetch_groq_models(api_key).await {
                    if !fetched.is_empty() {
                        models.extend(fetched);
                        groq_added = true;
                    }
                }
                if !groq_added {
                    let groq_catalog = vec![
                        (
                            "llama-3.3-70b-versatile",
                            "Groq LLaMA 3.3 70B [FREE TIER]",
                            128000,
                            false,
                        ),
                        (
                            "deepseek-r1-distill-llama-70b",
                            "Groq DeepSeek R1 70B [FREE TIER]",
                            128000,
                            false,
                        ),
                        (
                            "qwen-2.5-coder-32b",
                            "Groq Qwen 2.5 Coder 32B [FREE TIER]",
                            32768,
                            false,
                        ),
                        (
                            "mixtral-8x7b-32768",
                            "Groq Mixtral 8x7B [FREE TIER]",
                            32768,
                            false,
                        ),
                        (
                            "llama-3.1-8b-instant",
                            "Groq LLaMA 3.1 8B [FREE TIER]",
                            128000,
                            false,
                        ),
                        ("gemma2-9b-it", "Groq Gemma 2 9B [FREE TIER]", 8192, false),
                    ];
                    for (id, name, ctx, vision) in groq_catalog {
                        models.push(serde_json::json!({
                            "id": id,
                            "name": name,
                            "provider": "groq",
                            "version": "Ultra-Fast Free Tier",
                            "context_window": ctx,
                            "supports_vision": vision,
                            "is_free": true,
                            "has_api_key": true,
                            "status": "available",
                        }));
                    }
                }
            }

            // 5. OpenAI models (only if OpenAI API key configured)
            if let Some(ref api_key) = openai_key {
                let mut openai_added = false;
                if let Ok(fetched) = fetch_openai_models(api_key).await {
                    if !fetched.is_empty() {
                        models.extend(fetched);
                        openai_added = true;
                    }
                }
                if !openai_added {
                    let openai_catalog = vec![
                        ("gpt-4o", "OpenAI GPT-4o", 128000, true),
                        ("gpt-4o-mini", "OpenAI GPT-4o Mini", 128000, true),
                        ("o3-mini", "OpenAI o3-mini Reasoning", 200000, false),
                        ("o1", "OpenAI o1 Reasoning", 200000, true),
                        ("o1-mini", "OpenAI o1 Mini", 128000, false),
                        ("gpt-4-turbo", "OpenAI GPT-4 Turbo", 128000, true),
                        (
                            "chatgpt-4o-latest",
                            "OpenAI ChatGPT-4o Latest",
                            128000,
                            true,
                        ),
                    ];
                    for (id, name, ctx, vision) in openai_catalog {
                        models.push(serde_json::json!({
                            "id": id,
                            "name": name,
                            "provider": "openai",
                            "version": "Cloud API",
                            "context_window": ctx,
                            "supports_vision": vision,
                            "is_free": false,
                            "has_api_key": true,
                            "status": "available",
                        }));
                    }
                }
            }

            // 6. Anthropic models (only if Anthropic API key configured)
            if let Some(ref api_key) = anthropic_key {
                let mut anthropic_added = false;
                if let Ok(fetched) = fetch_anthropic_models(api_key).await {
                    if !fetched.is_empty() {
                        models.extend(fetched);
                        anthropic_added = true;
                    }
                }
                if !anthropic_added {
                    let anthropic_catalog = vec![
                        (
                            "claude-3-7-sonnet-20250219",
                            "Anthropic Claude 3.7 Sonnet (Hybrid Reasoning)",
                            200000,
                            true,
                        ),
                        (
                            "claude-3-5-sonnet-20241022",
                            "Anthropic Claude 3.5 Sonnet",
                            200000,
                            true,
                        ),
                        (
                            "claude-3-5-haiku-20241022",
                            "Anthropic Claude 3.5 Haiku",
                            200000,
                            false,
                        ),
                        (
                            "claude-3-opus-20240229",
                            "Anthropic Claude 3 Opus",
                            200000,
                            true,
                        ),
                    ];
                    for (id, name, ctx, vision) in anthropic_catalog {
                        models.push(serde_json::json!({
                            "id": id,
                            "name": name,
                            "provider": "anthropic",
                            "version": "Cloud API",
                            "context_window": ctx,
                            "supports_vision": vision,
                            "is_free": false,
                            "has_api_key": true,
                            "status": "available",
                        }));
                    }
                }
            }

            // 7. DeepSeek models (only if DeepSeek API key configured)
            if has_deepseek_key {
                let deepseek_catalog = vec![
                    ("deepseek-chat", "DeepSeek V3 Chat", 64000, false),
                    ("deepseek-reasoner", "DeepSeek R1 Reasoner", 64000, false),
                    ("deepseek-coder", "DeepSeek Coder V2", 64000, false),
                ];
                for (id, name, ctx, vision) in deepseek_catalog {
                    models.push(serde_json::json!({
                        "id": id,
                        "name": name,
                        "provider": "deepseek",
                        "version": "Cloud API",
                        "context_window": ctx,
                        "supports_vision": vision,
                        "is_free": false,
                        "has_api_key": true,
                        "status": "available",
                    }));
                }
            }

            // 8. Custom Endpoints
            if let Some(custom_str) = get_api_key(db, "custom_endpoints") {
                if let Ok(endpoints) = serde_json::from_str::<Vec<serde_json::Value>>(&custom_str) {
                    for ep in endpoints {
                        let name = ep.get("name").and_then(|v| v.as_str()).unwrap_or("Custom");
                        let model_id = ep
                            .get("model_id")
                            .and_then(|v| v.as_str())
                            .unwrap_or("custom-model");
                        models.push(serde_json::json!({
                            "id": model_id,
                            "name": format!("{name} ({model_id})"),
                            "provider": "custom",
                            "version": "Custom Endpoint",
                            "context_window": 128000,
                            "supports_vision": false,
                            "is_free": false,
                            "has_api_key": true,
                            "status": "available",
                        }));
                    }
                }
            }

            Ok(serde_json::Value::Array(models))
        }
        "execute_prompt" => {
            let model_id = payload
                .get("model_id")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'model_id'")?
                .to_string();
            let prompt = payload
                .get("prompt")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'prompt'")?
                .to_string();
            let system_prompt = payload
                .get("system_prompt")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let openai_key = get_api_key(db, "openai");
            let anthropic_key = get_api_key(db, "anthropic");
            let deepseek_key = get_api_key(db, "deepseek");
            let groq_key = get_api_key(db, "groq");
            let openrouter_key = get_api_key(db, "openrouter");
            let gemini_key = get_api_key(db, "gemini");
            let custom_str = get_api_key(db, "custom_endpoints");

            let res = execute_prompt_non_streaming(
                &model_id,
                &prompt,
                system_prompt.as_deref(),
                openai_key.as_deref(),
                anthropic_key.as_deref(),
                deepseek_key.as_deref(),
                groq_key.as_deref(),
                openrouter_key.as_deref(),
                gemini_key.as_deref(),
                custom_str.as_deref(),
            )
            .await?;

            Ok(serde_json::json!({ "response": res }))
        }
        "stream_prompt" => {
            let model_id = payload
                .get("model_id")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'model_id'")?
                .to_string();
            let prompt = payload
                .get("prompt")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'prompt'")?
                .to_string();
            let system_prompt = payload
                .get("system_prompt")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let request_id = payload
                .get("request_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            let image_paths: Vec<String> = payload
                .get("image_paths")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            let history_json = payload.get("history").and_then(|v| v.as_array());
            let mut history_messages = Vec::new();
            if let Some(arr) = history_json {
                for val in arr {
                    if let (Some(role), Some(content)) = (
                        val.get("role").and_then(|v| v.as_str()),
                        val.get("content").and_then(|v| v.as_str()),
                    ) {
                        history_messages.push((role.to_string(), content.to_string()));
                    }
                }
            }

            let app_clone = app.clone();
            let openai_key = get_api_key(db, "openai");
            let anthropic_key = get_api_key(db, "anthropic");
            let deepseek_key = get_api_key(db, "deepseek");
            let groq_key = get_api_key(db, "groq");
            let openrouter_key = get_api_key(db, "openrouter");
            let gemini_key = get_api_key(db, "gemini");
            let custom_str = get_api_key(db, "custom_endpoints");

            tokio::spawn(async move {
                // OpenRouter (matches anything with "/" like "anthropic/claude-3.5-sonnet" or contains "openrouter")
                if is_openrouter_model(&model_id) {
                    if let Some(key) = openrouter_key {
                        let key_trimmed = key.trim().to_string();
                        if !key_trimmed.is_empty() {
                            stream_openai_compat(
                                "https://openrouter.ai/api/v1",
                                &key_trimmed,
                                &model_id,
                                &prompt,
                                system_prompt.as_deref(),
                                &history_messages,
                                &image_paths,
                                &request_id,
                                &app_clone,
                            )
                            .await;
                            return;
                        }
                    }
                    emit_model_stream(&app_clone, ModelStreamEvent {
                        request_id: Some(request_id.clone()),
                        delta: None,
                        error: Some("OpenRouter API key is missing. Please open Settings (⚙️) and enter your OpenRouter API key.".to_string()),
                        finished: true,
                    });
                    return;
                }

                // OpenAI
                if is_openai_model(&model_id) {
                    if let Some(key) = openai_key {
                        let key_trimmed = key.trim().to_string();
                        if !key_trimmed.is_empty() {
                            stream_openai_compat(
                                "https://api.openai.com/v1",
                                &key_trimmed,
                                &model_id,
                                &prompt,
                                system_prompt.as_deref(),
                                &history_messages,
                                &image_paths,
                                &request_id,
                                &app_clone,
                            )
                            .await;
                            return;
                        }
                    }
                    emit_model_stream(
                        &app_clone,
                        ModelStreamEvent {
                            request_id: Some(request_id.clone()),
                            delta: None,
                            error: Some(
                                "OpenAI API key is missing. Please configure it in Settings (⚙️)."
                                    .to_string(),
                            ),
                            finished: true,
                        },
                    );
                    return;
                }

                // DeepSeek
                if model_id.starts_with("deepseek") {
                    if let Some(key) = deepseek_key {
                        let key_trimmed = key.trim().to_string();
                        if !key_trimmed.is_empty() {
                            stream_openai_compat(
                                "https://api.deepseek.com",
                                &key_trimmed,
                                &model_id,
                                &prompt,
                                system_prompt.as_deref(),
                                &history_messages,
                                &image_paths,
                                &request_id,
                                &app_clone,
                            )
                            .await;
                            return;
                        }
                    }
                    emit_model_stream(&app_clone, ModelStreamEvent {
                        request_id: Some(request_id.clone()),
                        delta: None,
                        error: Some("DeepSeek API key is missing. Please configure it in Settings (⚙️).".to_string()),
                        finished: true,
                    });
                    return;
                }

                // Groq
                if is_groq_model(&model_id) {
                    if let Some(key) = groq_key {
                        let key_trimmed = key.trim().to_string();
                        if !key_trimmed.is_empty() {
                            stream_openai_compat(
                                "https://api.groq.com/openai/v1",
                                &key_trimmed,
                                &model_id,
                                &prompt,
                                system_prompt.as_deref(),
                                &history_messages,
                                &image_paths,
                                &request_id,
                                &app_clone,
                            )
                            .await;
                            return;
                        }
                    }
                    emit_model_stream(
                        &app_clone,
                        ModelStreamEvent {
                            request_id: Some(request_id.clone()),
                            delta: None,
                            error: Some(
                                "Groq API key is missing. Please configure it in Settings (⚙️)."
                                    .to_string(),
                            ),
                            finished: true,
                        },
                    );
                    return;
                }

                // Gemini (OpenAI Compat endpoint)
                if is_gemini_model(&model_id) {
                    if let Some(key) = gemini_key {
                        let key_trimmed = key.trim().to_string();
                        if !key_trimmed.is_empty() {
                            stream_openai_compat(
                                "https://generativelanguage.googleapis.com/v1beta/openai",
                                &key_trimmed,
                                &model_id,
                                &prompt,
                                system_prompt.as_deref(),
                                &history_messages,
                                &image_paths,
                                &request_id,
                                &app_clone,
                            )
                            .await;
                            return;
                        }
                    }
                    emit_model_stream(&app_clone, ModelStreamEvent {
                        request_id: Some(request_id.clone()),
                        delta: None,
                        error: Some("Google Gemini API key is missing. Please configure it in Settings (⚙️).".to_string()),
                        finished: true,
                    });
                    return;
                }

                // Anthropic
                if is_anthropic_model(&model_id) {
                    if let Some(key) = anthropic_key {
                        let key_trimmed = key.trim().to_string();
                        if !key_trimmed.is_empty() {
                            stream_anthropic(
                                &key_trimmed,
                                &model_id,
                                &prompt,
                                system_prompt.as_deref(),
                                &history_messages,
                                &image_paths,
                                &request_id,
                                &app_clone,
                            )
                            .await;
                            return;
                        }
                    }
                    emit_model_stream(&app_clone, ModelStreamEvent {
                        request_id: Some(request_id.clone()),
                        delta: None,
                        error: Some("Anthropic API key is missing. Please configure it in Settings (⚙️).".to_string()),
                        finished: true,
                    });
                    return;
                }

                // Custom Endpoints check
                if let Some(custom_data) = custom_str {
                    if let Ok(endpoints) =
                        serde_json::from_str::<Vec<serde_json::Value>>(&custom_data)
                    {
                        for ep in endpoints {
                            let ep_model =
                                ep.get("model_id").and_then(|v| v.as_str()).unwrap_or("");
                            if ep_model == model_id
                                || ep.get("name").and_then(|v| v.as_str()).unwrap_or("") == model_id
                            {
                                let base_url = ep
                                    .get("base_url")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("http://localhost:8000/v1");
                                let key = ep.get("api_key").and_then(|v| v.as_str()).unwrap_or("");
                                stream_openai_compat(
                                    base_url,
                                    key,
                                    &model_id,
                                    &prompt,
                                    system_prompt.as_deref(),
                                    &history_messages,
                                    &image_paths,
                                    &request_id,
                                    &app_clone,
                                )
                                .await;
                                return;
                            }
                        }
                    }
                }

                // Default fallback: Ollama local
                let client = OllamaClient::new(None);
                let mut messages = Vec::new();
                if let Some(sp) = &system_prompt {
                    messages.push(OllamaMessage::system(sp));
                }
                for (role, content) in &history_messages {
                    if role == "user" {
                        messages.push(OllamaMessage::user(content));
                    } else {
                        messages.push(OllamaMessage::assistant(content));
                    }
                }

                let mut b64_images = Vec::new();
                for path in &image_paths {
                    if let Ok(b64) = read_image_base64(path) {
                        b64_images.push(b64);
                    }
                }

                let user_msg = if !b64_images.is_empty() {
                    OllamaMessage::user_with_images(&prompt, b64_images)
                } else {
                    OllamaMessage::user(&prompt)
                };
                messages.push(user_msg);

                let req = OllamaChatRequest {
                    model: model_id,
                    messages,
                    tools: None,
                    options: Some(serde_json::json!({
                        "num_ctx": 65536,
                        "num_predict": 16384,
                        "temperature": 0.2
                    })),
                    stream: true,
                };

                match client.chat_stream(&req).await {
                    Ok(mut stream) => {
                        while let Some(chunk) = stream.next().await {
                            match chunk {
                                Ok(resp) => {
                                    let done = resp.done.unwrap_or(false);
                                    let delta = resp.message.and_then(|m| m.content);
                                    emit_model_stream(
                                        &app_clone,
                                        ModelStreamEvent {
                                            request_id: Some(request_id.clone()),
                                            delta,
                                            error: None,
                                            finished: done,
                                        },
                                    );
                                    if done {
                                        return;
                                    }
                                }
                                Err(e) => {
                                    emit_model_stream(
                                        &app_clone,
                                        ModelStreamEvent {
                                            request_id: Some(request_id.clone()),
                                            delta: None,
                                            error: Some(e),
                                            finished: true,
                                        },
                                    );
                                    return;
                                }
                            }
                        }
                        emit_model_stream(
                            &app_clone,
                            ModelStreamEvent {
                                request_id: Some(request_id),
                                delta: None,
                                error: None,
                                finished: true,
                            },
                        );
                    }
                    Err(e) => {
                        emit_model_stream(
                            &app_clone,
                            ModelStreamEvent {
                                request_id: Some(request_id),
                                delta: None,
                                error: Some(e),
                                finished: true,
                            },
                        );
                    }
                }
            });

            Ok(serde_json::json!({ "started": true }))
        }
        _ => Err(format!("Unknown models action: {action}")),
    }
}

pub fn is_openai_model(id: &str) -> bool {
    id.starts_with("gpt-")
        || id.starts_with("o1")
        || id.starts_with("o3")
        || id.starts_with("o4")
        || id.starts_with("chatgpt")
        || id.contains("openai")
}

pub fn is_anthropic_model(id: &str) -> bool {
    id.starts_with("claude-") || id.contains("anthropic")
}

pub fn is_groq_model(id: &str) -> bool {
    id.contains("versatile") || id.contains("mixtral") || id.contains("groq")
}

pub fn is_openrouter_model(id: &str) -> bool {
    id.contains("/") || id.contains("openrouter")
}

pub fn is_deepseek_model(id: &str) -> bool {
    id.starts_with("deepseek")
}

pub fn is_gemini_model(id: &str) -> bool {
    id.starts_with("gemini-") || id.contains("gemini")
}

async fn fetch_openai_models(api_key: &str) -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.openai.com/v1/models")
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err("Failed to fetch OpenAI models".to_string());
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut list = Vec::new();

    if let Some(data) = json["data"].as_array() {
        for m in data {
            if let Some(id) = m["id"].as_str() {
                if id.starts_with("gpt-")
                    || id.starts_with("o1")
                    || id.starts_with("o3")
                    || id.starts_with("o4")
                    || id.starts_with("chatgpt-")
                {
                    let vision = id.contains("4o") || id.contains("vision") || id.contains("turbo");
                    list.push(serde_json::json!({
                        "id": id,
                        "name": format!("OpenAI {id}"),
                        "provider": "openai",
                        "version": "Cloud API",
                        "context_window": if id.contains("o3") || id.contains("o1") { 200000 } else { 128000 },
                        "supports_vision": vision,
                        "is_free": false,
                        "has_api_key": true,
                        "status": "available",
                    }));
                }
            }
        }
    }

    Ok(list)
}

async fn fetch_anthropic_models(api_key: &str) -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Csotic-IDE/0.1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err("Failed to fetch Anthropic models".to_string());
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut list = Vec::new();

    if let Some(data) = json["data"].as_array() {
        for m in data {
            if let Some(id) = m["id"].as_str() {
                let display_name = m["display_name"].as_str().unwrap_or(id);
                list.push(serde_json::json!({
                    "id": id,
                    "name": format!("Anthropic {display_name}"),
                    "provider": "anthropic",
                    "version": "Cloud API",
                    "context_window": 200000,
                    "supports_vision": id.contains("3-5") || id.contains("opus") || id.contains("3-7"),
                    "is_free": false,
                    "has_api_key": true,
                    "status": "available",
                }));
            }
        }
    }

    Ok(list)
}

async fn fetch_openrouter_models(api_key: &str) -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Csotic-IDE/0.1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut req = client
        .get("https://openrouter.ai/api/v1/models")
        .header("HTTP-Referer", "https://csotic.dev")
        .header("X-Title", "Csotic IDE");

    if !api_key.trim().is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key.trim()));
    }

    let res = req.send().await.map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!(
            "Failed to fetch OpenRouter models ({status}): {err_text}"
        ));
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut list = Vec::new();

    if let Some(data) = json["data"].as_array() {
        for m in data {
            if let Some(id) = m["id"].as_str() {
                // Skip moderation or non-chat test endpoints
                if id.contains("moderation") || id.starts_with("test/") || id.starts_with("eval/") {
                    continue;
                }

                let name = m["name"].as_str().unwrap_or(id);
                let ctx = m["context_length"].as_u64().unwrap_or(128000) as u32;

                let is_prompt_zero = m["pricing"]["prompt"]
                    .as_str()
                    .map(|s| {
                        s == "0"
                            || s == "0.0"
                            || s.parse::<f64>().map(|v| v == 0.0).unwrap_or(false)
                    })
                    .or_else(|| m["pricing"]["prompt"].as_f64().map(|v| v == 0.0))
                    .unwrap_or(false);
                let is_compl_zero = m["pricing"]["completion"]
                    .as_str()
                    .map(|s| {
                        s == "0"
                            || s == "0.0"
                            || s.parse::<f64>().map(|v| v == 0.0).unwrap_or(false)
                    })
                    .or_else(|| m["pricing"]["completion"].as_f64().map(|v| v == 0.0))
                    .unwrap_or(false);

                let is_free = id.ends_with(":free") || (is_prompt_zero && is_compl_zero);
                let is_vision = m["architecture"]["modality"]
                    .as_str()
                    .map(|s| s.contains("image") || s.contains("multimodal"))
                    .unwrap_or(false)
                    || id.contains("4o")
                    || id.contains("claude-3")
                    || id.contains("gemini")
                    || id.contains("vision")
                    || id.contains("pixtral");

                let display_name = if is_free && !name.contains("[FREE]") {
                    format!("{} [FREE]", name)
                } else {
                    name.to_string()
                };

                list.push(serde_json::json!({
                    "id": id,
                    "name": display_name,
                    "provider": "openrouter",
                    "version": if is_free { "Free Cloud Model" } else { "OpenRouter Cloud API" },
                    "context_window": ctx,
                    "supports_vision": is_vision,
                    "is_free": is_free,
                    "has_api_key": !api_key.trim().is_empty(),
                    "status": "available",
                }));
            }
        }
    }

    list.sort_by(|a, b| {
        let a_free = a["is_free"].as_bool().unwrap_or(false);
        let b_free = b["is_free"].as_bool().unwrap_or(false);
        if a_free != b_free {
            return b_free.cmp(&a_free);
        }
        let a_name = a["name"].as_str().unwrap_or("");
        let b_name = b["name"].as_str().unwrap_or("");
        a_name.cmp(b_name)
    });

    Ok(list)
}

async fn fetch_groq_models(api_key: &str) -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Csotic-IDE/0.1.0")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let res = client
        .get("https://api.groq.com/openai/v1/models")
        .header("Authorization", format!("Bearer {api_key}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err("Failed to fetch Groq models".to_string());
    }

    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    let mut list = Vec::new();

    if let Some(data) = json["data"].as_array() {
        for m in data {
            if let Some(id) = m["id"].as_str() {
                let is_vision = id.contains("vision") || id.contains("vl");
                list.push(serde_json::json!({
                    "id": id,
                    "name": format!("Groq {} [FREE TIER]", id),
                    "provider": "groq",
                    "version": "Ultra-Fast Free Tier",
                    "context_window": if id.contains("32768") { 32768 } else { 128000 },
                    "supports_vision": is_vision,
                    "is_free": true,
                    "has_api_key": true,
                    "status": "available",
                }));
            }
        }
    }
    Ok(list)
}

async fn stream_openai_compat(
    base_url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    system_prompt: Option<&str>,
    history: &[(String, String)],
    image_paths: &[String],
    request_id: &str,
    app: &AppHandle,
) {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let mut messages = Vec::new();
    if let Some(sp) = system_prompt {
        messages.push(serde_json::json!({ "role": "system", "content": sp }));
    }
    for (role, content) in history {
        messages.push(serde_json::json!({ "role": role, "content": content }));
    }

    if !image_paths.is_empty() {
        let mut parts = vec![serde_json::json!({
            "type": "text",
            "text": prompt
        })];
        for img in image_paths {
            if let Ok(b64) = read_image_base64(img) {
                let data_url = if img.starts_with("data:image/") {
                    img.clone()
                } else {
                    format!("data:image/jpeg;base64,{b64}")
                };
                parts.push(serde_json::json!({
                    "type": "image_url",
                    "image_url": {
                        "url": data_url
                    }
                }));
            }
        }
        messages.push(serde_json::json!({ "role": "user", "content": parts }));
    } else {
        messages.push(serde_json::json!({ "role": "user", "content": prompt }));
    }

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let mut req_builder = client
        .post(&url)
        .header("User-Agent", "Csotic-IDE/0.1.0")
        .header("HTTP-Referer", "https://csotic.dev")
        .header("X-Title", "Csotic IDE");

    if !api_key.trim().is_empty() {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key.trim()));
    }

    let mut candidate_models = vec![model.to_string()];
    // Configure free fallbacks: if the requested model is an OpenRouter free-tier model
    // (ends with :free, is the auto-router, or is a live-fetched free model that returned 404/429)
    if base_url.contains("openrouter") {
        for fallback in &[
            "meta-llama/llama-3.3-70b-instruct:free",
            "deepseek/deepseek-chat:free",
            "deepseek/deepseek-r1:free",
            "google/gemini-2.0-flash-exp:free",
            "meta-llama/llama-3.2-3b-instruct:free",
            "openrouter/free",
        ] {
            if *fallback != model {
                candidate_models.push(fallback.to_string());
            }
        }
    }

    let mut last_clean_error = String::new();

    for (attempt_idx, current_target_model) in candidate_models.iter().enumerate() {
        let resolved_model = current_target_model.as_str();

        let mut body = serde_json::json!({
            "model": resolved_model,
            "messages": messages,
            "temperature": 0.6,
            "max_tokens": 16384,
            "stream": true,
        });

        if base_url.contains("openrouter") {
            body["provider"] = serde_json::json!({
                "allow_fallbacks": true,
                "data_collection": "allow"
            });
        }

        let res = match req_builder
            .try_clone()
            .unwrap_or_else(|| client.post(&url))
            .json(&body)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                last_clean_error = format!("Network connection failed: {e}");
                continue;
            }
        };

        if !res.status().is_success() {
            let status = res.status();
            let err_text = res.text().await.unwrap_or_default();

            if status.as_u16() == 401 {
                emit_model_stream(app, ModelStreamEvent {
                    request_id: Some(request_id.to_string()),
                    delta: None,
                    error: Some("⚠️ Authentication failed (401): API key for this provider is invalid or expired. Please check Settings (⚙️).".to_string()),
                    finished: true,
                });
                return;
            }

            if status.as_u16() == 402 {
                emit_model_stream(app, ModelStreamEvent {
                    request_id: Some(request_id.to_string()),
                    delta: None,
                    error: Some(format!("⚠️ Insufficient credits (402): Your account does not have enough credits for '{resolved_model}'. Please add credits on openrouter.ai or select a [FREE] model from the top bar.")),
                    finished: true,
                });
                return;
            }

            let clean_json_msg = serde_json::from_str::<serde_json::Value>(&err_text)
                .ok()
                .and_then(|parsed| {
                    parsed
                        .get("error")
                        .and_then(|e| {
                            if let Some(msg) = e.get("message").and_then(|m| m.as_str()) {
                                Some(msg.to_string())
                            } else {
                                e.as_str().map(|s| s.to_string())
                            }
                        })
                        .or_else(|| {
                            parsed
                                .get("message")
                                .and_then(|m| m.as_str())
                                .map(|s| s.to_string())
                        })
                })
                .unwrap_or_else(|| err_text.clone());

            last_clean_error = if err_text.contains("rate-limited") || status.as_u16() == 429 {
                format!("⚠️ Model '{}' is temporarily rate-limited upstream (429). Please select Meta LLaMA 3.3 70B, DeepSeek, or Gemini 2.0 Flash from the top bar.", resolved_model)
            } else {
                format!("⚠️ API error ({status}): {clean_json_msg}")
            };

            // If we have more candidates on retryable errors, try the next one
            if (status.as_u16() == 404 || status.as_u16() == 429 || status.as_u16() == 503)
                && attempt_idx + 1 < candidate_models.len()
            {
                continue;
            }

            emit_model_stream(
                app,
                ModelStreamEvent {
                    request_id: Some(request_id.to_string()),
                    delta: None,
                    error: Some(last_clean_error),
                    finished: true,
                },
            );
            return;
        }

        // If fallback model used, emit notice
        if attempt_idx > 0 {
            emit_model_stream(
                app,
                ModelStreamEvent {
                    request_id: Some(request_id.to_string()),
                    delta: Some(format!(
                        "[Notice: '{}' was busy upstream. Auto-routed to '{}']\n\n",
                        model, current_target_model
                    )),
                    error: None,
                    finished: false,
                },
            );
        }

        let mut stream = res.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk) = stream.next().await {
            if let Ok(bytes) = chunk {
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    buffer.push_str(text);

                    while let Some(pos) = buffer.find('\n') {
                        let line = buffer[..pos].trim().to_string();
                        buffer = buffer[pos + 1..].to_string();

                        if line.is_empty() || line.starts_with(':') {
                            continue;
                        }

                        if let Some(data_raw) = line.strip_prefix("data:") {
                            let data = data_raw.trim();
                            if data == "[DONE]" {
                                emit_model_stream(
                                    app,
                                    ModelStreamEvent {
                                        request_id: Some(request_id.to_string()),
                                        delta: None,
                                        error: None,
                                        finished: true,
                                    },
                                );
                                return;
                            }
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                if let Some(err) = json.get("error") {
                                    let msg = if let Some(m) =
                                        err.get("message").and_then(|m| m.as_str())
                                    {
                                        m.to_string()
                                    } else if let Some(s) = err.as_str() {
                                        s.to_string()
                                    } else {
                                        err.to_string()
                                    };
                                    emit_model_stream(
                                        app,
                                        ModelStreamEvent {
                                            request_id: Some(request_id.to_string()),
                                            delta: None,
                                            error: Some(format!("API error: {msg}")),
                                            finished: true,
                                        },
                                    );
                                    return;
                                }
                                if let Some(choices) = json["choices"].as_array() {
                                    if let Some(first) = choices.first() {
                                        let content = first["delta"]["content"]
                                            .as_str()
                                            .or_else(|| first["delta"]["reasoning"].as_str())
                                            .or_else(|| {
                                                first["delta"]["reasoning_content"].as_str()
                                            })
                                            .or_else(|| first["text"].as_str());

                                        if let Some(c) = content {
                                            if !c.is_empty() {
                                                emit_model_stream(
                                                    app,
                                                    ModelStreamEvent {
                                                        request_id: Some(request_id.to_string()),
                                                        delta: Some(c.to_string()),
                                                        error: None,
                                                        finished: false,
                                                    },
                                                );
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        emit_model_stream(
            app,
            ModelStreamEvent {
                request_id: Some(request_id.to_string()),
                delta: None,
                error: None,
                finished: true,
            },
        );
        return;
    }

    emit_model_stream(
        app,
        ModelStreamEvent {
            request_id: Some(request_id.to_string()),
            delta: None,
            error: Some(last_clean_error),
            finished: true,
        },
    );
}

async fn stream_anthropic(
    api_key: &str,
    model: &str,
    prompt: &str,
    system_prompt: Option<&str>,
    history: &[(String, String)],
    image_paths: &[String],
    request_id: &str,
    app: &AppHandle,
) {
    let client = reqwest::Client::new();
    let mut messages = Vec::new();
    for (role, content) in history {
        messages.push(serde_json::json!({ "role": role, "content": content }));
    }

    if !image_paths.is_empty() {
        let mut parts = vec![serde_json::json!({
            "type": "text",
            "text": prompt
        })];
        for img in image_paths {
            if let Ok(b64) = read_image_base64(img) {
                parts.push(serde_json::json!({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": b64
                    }
                }));
            }
        }
        messages.push(serde_json::json!({ "role": "user", "content": parts }));
    } else {
        messages.push(serde_json::json!({ "role": "user", "content": prompt }));
    }

    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": 8192,
        "temperature": 0.6,
        "messages": messages,
        "stream": true,
    });

    if let Some(sp) = system_prompt {
        body["system"] = serde_json::json!(sp);
    }

    let res = match client
        .post("https://api.anthropic.com/v1/messages")
        .header("User-Agent", "Csotic-IDE/0.1.0")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            emit_model_stream(
                app,
                ModelStreamEvent {
                    request_id: Some(request_id.to_string()),
                    delta: None,
                    error: Some(format!("Anthropic connection error: {e}")),
                    finished: true,
                },
            );
            return;
        }
    };

    if !res.status().is_success() {
        let err_text = res.text().await.unwrap_or_default();
        emit_model_stream(
            app,
            ModelStreamEvent {
                request_id: Some(request_id.to_string()),
                delta: None,
                error: Some(format!("Anthropic API error: {err_text}")),
                finished: true,
            },
        );
        return;
    }

    let mut stream = res.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        if let Ok(bytes) = chunk {
            if let Ok(text) = std::str::from_utf8(&bytes) {
                buffer.push_str(text);

                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].trim().to_string();
                    buffer = buffer[pos + 1..].to_string();

                    if let Some(data) = line.strip_prefix("data: ") {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                            if json["type"] == "content_block_delta" {
                                if let Some(text_delta) = json["delta"]["text"].as_str() {
                                    emit_model_stream(
                                        app,
                                        ModelStreamEvent {
                                            request_id: Some(request_id.to_string()),
                                            delta: Some(text_delta.to_string()),
                                            error: None,
                                            finished: false,
                                        },
                                    );
                                }
                            } else if json["type"] == "message_stop" {
                                emit_model_stream(
                                    app,
                                    ModelStreamEvent {
                                        request_id: Some(request_id.to_string()),
                                        delta: None,
                                        error: None,
                                        finished: true,
                                    },
                                );
                                return;
                            }
                        }
                    }
                }
            }
        }
    }

    emit_model_stream(
        app,
        ModelStreamEvent {
            request_id: Some(request_id.to_string()),
            delta: None,
            error: None,
            finished: true,
        },
    );
}

fn read_image_base64(path: &str) -> Result<String, String> {
    if let Some(pos) = path.find(";base64,") {
        return Ok(path[pos + 8..].to_string());
    }
    if path.starts_with("data:image/") {
        if let Some(pos) = path.find(',') {
            return Ok(path[pos + 1..].to_string());
        }
    }
    use std::io::Read;
    let clean = if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest
    } else if let Some(rest) = path.strip_prefix("//?/") {
        rest
    } else {
        path
    };
    let mut file = std::fs::File::open(clean).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    use base64::{engine::general_purpose, Engine as _};
    Ok(general_purpose::STANDARD.encode(&buf))
}

async fn execute_prompt_non_streaming(
    model_id: &str,
    prompt: &str,
    system_prompt: Option<&str>,
    openai_key: Option<&str>,
    anthropic_key: Option<&str>,
    deepseek_key: Option<&str>,
    groq_key: Option<&str>,
    openrouter_key: Option<&str>,
    gemini_key: Option<&str>,
    custom_str: Option<&str>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("Csotic-IDE/0.1.0")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    // 1. OpenRouter
    if is_openrouter_model(model_id) {
        let key = openrouter_key.unwrap_or("").trim();
        return call_openai_compat_completion(
            &client,
            "https://openrouter.ai/api/v1",
            key,
            model_id,
            prompt,
            system_prompt,
        )
        .await;
    }

    // 2. OpenAI
    if is_openai_model(model_id) {
        let key = openai_key.ok_or_else(|| {
            "OpenAI API key is missing. Please configure it in Settings.".to_string()
        })?;
        return call_openai_compat_completion(
            &client,
            "https://api.openai.com/v1",
            key.trim(),
            model_id,
            prompt,
            system_prompt,
        )
        .await;
    }

    // 3. DeepSeek
    if model_id.starts_with("deepseek") {
        let key = deepseek_key.ok_or_else(|| {
            "DeepSeek API key is missing. Please configure it in Settings.".to_string()
        })?;
        return call_openai_compat_completion(
            &client,
            "https://api.deepseek.com",
            key.trim(),
            model_id,
            prompt,
            system_prompt,
        )
        .await;
    }

    // 4. Groq
    if is_groq_model(model_id) {
        let key = groq_key.ok_or_else(|| {
            "Groq API key is missing. Please configure it in Settings.".to_string()
        })?;
        return call_openai_compat_completion(
            &client,
            "https://api.groq.com/openai/v1",
            key.trim(),
            model_id,
            prompt,
            system_prompt,
        )
        .await;
    }

    // 5. Gemini
    if is_gemini_model(model_id) {
        let key = gemini_key.ok_or_else(|| {
            "Gemini API key is missing. Please configure it in Settings.".to_string()
        })?;
        return call_openai_compat_completion(
            &client,
            "https://generativelanguage.googleapis.com/v1beta/openai",
            key.trim(),
            model_id,
            prompt,
            system_prompt,
        )
        .await;
    }

    // 6. Anthropic
    if is_anthropic_model(model_id) {
        let key = anthropic_key.ok_or_else(|| {
            "Anthropic API key is missing. Please configure it in Settings.".to_string()
        })?;
        let mut messages = Vec::new();
        messages.push(serde_json::json!({
            "role": "user",
            "content": prompt
        }));

        let mut body = serde_json::json!({
            "model": model_id,
            "messages": messages,
            "max_tokens": 4096,
        });
        if let Some(sys) = system_prompt {
            body["system"] = serde_json::Value::String(sys.to_string());
        }

        let res = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", key.trim())
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Anthropic request failed: {e}"))?;

        if !res.status().is_success() {
            let status = res.status();
            let err_txt = res.text().await.unwrap_or_default();
            return Err(format!("Anthropic error ({status}): {err_txt}"));
        }

        let json: serde_json::Value = res
            .json()
            .await
            .map_err(|e| format!("Failed to parse Anthropic JSON: {e}"))?;
        if let Some(content_arr) = json["content"].as_array() {
            for item in content_arr {
                if let Some(txt) = item.get("text").and_then(|t| t.as_str()) {
                    return Ok(txt.to_string());
                }
            }
        }
        return Ok(String::new());
    }

    // 7. Custom endpoints
    if let Some(custom_data) = custom_str {
        if let Ok(endpoints) = serde_json::from_str::<Vec<serde_json::Value>>(custom_data) {
            for ep in endpoints {
                let ep_model = ep.get("model_id").and_then(|v| v.as_str()).unwrap_or("");
                if ep_model == model_id
                    || ep.get("name").and_then(|v| v.as_str()).unwrap_or("") == model_id
                {
                    let base_url = ep
                        .get("base_url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("http://localhost:8000/v1");
                    let key = ep.get("api_key").and_then(|v| v.as_str()).unwrap_or("");
                    return call_openai_compat_completion(
                        &client,
                        base_url,
                        key,
                        model_id,
                        prompt,
                        system_prompt,
                    )
                    .await;
                }
            }
        }
    }

    // 8. Fallback: Ollama local chat API non-streaming
    let ollama_client = OllamaClient::new(None);
    let mut messages = Vec::new();
    if let Some(sys) = system_prompt {
        messages.push(OllamaMessage::system(sys));
    }
    messages.push(OllamaMessage::user(prompt));

    let req = OllamaChatRequest {
        model: model_id.to_string(),
        messages,
        tools: None,
        options: Some(serde_json::json!({
            "num_predict": 4096,
            "temperature": 0.2
        })),
        stream: false,
    };

    match ollama_client.chat(&req).await {
        Ok(resp) => Ok(resp.message.and_then(|m| m.content).unwrap_or_default()),
        Err(e) => Err(format!("Ollama local completion failed: {e}")),
    }
}

async fn call_openai_compat_completion(
    client: &reqwest::Client,
    base_url: &str,
    api_key: &str,
    model: &str,
    prompt: &str,
    system_prompt: Option<&str>,
) -> Result<String, String> {
    let mut messages = Vec::new();
    if let Some(sys) = system_prompt {
        messages.push(serde_json::json!({
            "role": "system",
            "content": sys
        }));
    }
    messages.push(serde_json::json!({
        "role": "user",
        "content": prompt
    }));

    let mut body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 4096,
        "stream": false
    });

    if base_url.contains("openrouter") {
        body["provider"] = serde_json::json!({
            "allow_fallbacks": true,
            "data_collection": "allow"
        });
    }

    let url = if base_url.ends_with("/chat/completions") {
        base_url.to_string()
    } else {
        format!("{}/chat/completions", base_url.trim_end_matches('/'))
    };

    let mut req_builder = client.post(&url);
    if !api_key.trim().is_empty() {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key.trim()));
    }
    if base_url.contains("openrouter") {
        req_builder = req_builder
            .header("HTTP-Referer", "https://csotic.dev")
            .header("X-Title", "Csotic IDE");
    }

    let res = req_builder
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network request failed: {e}"))?;
    if !res.status().is_success() {
        let status = res.status();
        let err_text = res.text().await.unwrap_or_default();
        return Err(format!("Model API error ({status}): {err_text}"));
    }

    let json: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse response JSON: {e}"))?;
    if let Some(choices) = json["choices"].as_array() {
        if let Some(first) = choices.first() {
            if let Some(content) = first
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_str())
            {
                return Ok(content.to_string());
            }
        }
    }
    Ok(String::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_secret_encode_decode_roundtrip() {
        let raw = "sk-test-openai-secret-key-12345";
        let encoded = encode_secret(raw);
        assert_ne!(encoded, raw);
        assert!(encoded.starts_with("enc_v1:"));
        let decoded = decode_secret(&encoded);
        assert_eq!(decoded, raw);
    }

    #[test]
    fn test_legacy_secret_decode_backward_compat() {
        use base64::Engine;
        let legacy_salted = "__FORGE_SEC_sk-ant-legacy-key__";
        let legacy_encoded =
            base64::engine::general_purpose::STANDARD.encode(legacy_salted.as_bytes());
        let decoded = decode_secret(&legacy_encoded);
        assert_eq!(decoded, "sk-ant-legacy-key");
    }

    #[tokio::test]
    async fn test_execute_prompt_missing_api_key_error_shape() {
        let res = execute_prompt_non_streaming(
            "gpt-4o", "hello", None, None, None, None, None, None, None, None,
        )
        .await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("OpenAI API key is missing"));
    }
}
