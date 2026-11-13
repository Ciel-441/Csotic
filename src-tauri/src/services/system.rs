use crate::ollama::client::OllamaClient;
use std::fs::{create_dir_all, OpenOptions};
use std::io::Write;
use tauri::{Emitter, Manager};

#[cfg(target_os = "windows")]
pub fn trim_process_memory() {
    extern "system" {
        fn GetCurrentProcess() -> isize;
        fn K32EmptyWorkingSet(hProcess: isize) -> i32;
        fn SetProcessWorkingSetSize(
            hProcess: isize,
            dwMinimumWorkingSetSize: usize,
            dwMaximumWorkingSetSize: usize,
        ) -> i32;
    }
    unsafe {
        let process = GetCurrentProcess();
        K32EmptyWorkingSet(process);
        SetProcessWorkingSetSize(process, usize::MAX, usize::MAX);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn trim_process_memory() {
    // No-op on non-Windows platforms
}

pub async fn handle(
    action: &str,
    payload: &serde_json::Value,
    app_handle: &tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    match action {
        "trim_memory" => {
            trim_process_memory();
            Ok(serde_json::json!({ "trimmed": true }))
        }
        "health" => {
            let client = OllamaClient::new(None);
            let ollama_reachable = client.is_reachable().await;

            Ok(serde_json::json!({
                "ok": true,
                "ollama_reachable": ollama_reachable
            }))
        }
        "diagnostics" => {
            let db_ok = {
                let state = app_handle.state::<crate::AppState>();
                let result = match state.db.lock() {
                    Ok(conn) => conn.execute_batch("SELECT 1").is_ok(),
                    Err(_) => false,
                };
                result
            };

            let client = OllamaClient::new(None);
            let ollama_reachable = client.is_reachable().await;

            let state_json: Option<String> = {
                let state = app_handle.state::<crate::AppState>();
                let conn = state.db.lock().map_err(|e| format!("DB lock error: {e}"))?;
                let mut stmt = conn
                    .prepare("SELECT state_json FROM workspaces LIMIT 1")
                    .ok();
                stmt.as_mut()
                    .and_then(|s| s.query_row([], |row| row.get(0)).ok())
            };

            let (active_project, active_model, background_model) =
                if let Some(json_str) = state_json {
                    if let Ok(ws) = serde_json::from_str::<serde_json::Value>(&json_str) {
                        let active_project = ws
                            .get("active_project")
                            .and_then(|p| p.get("path"))
                            .and_then(|p| p.as_str())
                            .unwrap_or("None")
                            .to_string();
                        let active_model = ws
                            .get("active_model")
                            .and_then(|m| m.as_str())
                            .unwrap_or("None")
                            .to_string();
                        let background_model = ws
                            .get("background_model")
                            .and_then(|m| m.as_str())
                            .unwrap_or("None")
                            .to_string();
                        (active_project, active_model, background_model)
                    } else {
                        ("None".to_string(), "None".to_string(), "None".to_string())
                    }
                } else {
                    ("None".to_string(), "None".to_string(), "None".to_string())
                };

            Ok(serde_json::json!({
                "version": env!("CARGO_PKG_VERSION"),
                "platform": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
                "active_project": active_project,
                "active_model": active_model,
                "background_model": background_model,
                "db_status": if db_ok { "Connected" } else { "Error" },
                "ollama_status": if ollama_reachable { "Online" } else { "Offline" }
            }))
        }
        "log" => {
            let level = payload
                .get("level")
                .and_then(|v| v.as_str())
                .unwrap_or("info");
            let message = payload
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("");

            match level {
                "error" => tracing::error!("{}", message),
                "warn" => tracing::warn!("{}", message),
                "debug" => tracing::debug!("{}", message),
                _ => tracing::info!("{}", message),
            }

            let timestamp = chrono::Utc::now().to_rfc3339();
            if level == "error" || level == "warn" {
                if let Ok(app_dir) = app_handle.path().app_data_dir() {
                    let _ = create_dir_all(&app_dir);
                    let log_file_path = app_dir.join("app.log");
                    if let Ok(mut file) = OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(log_file_path)
                    {
                        let _ = writeln!(
                            file,
                            "[{}] [{}] {}",
                            timestamp,
                            level.to_uppercase(),
                            message
                        );
                    }
                }
            }

            // Emit live log entry event
            app_handle
                .emit(
                    "log-entry",
                    serde_json::json!({
                        "timestamp": timestamp,
                        "level": level.to_uppercase(),
                        "message": message
                    }),
                )
                .ok();

            Ok(serde_json::json!({ "logged": true }))
        }
        _ => Err(format!("Unknown system action: {action}")),
    }
}
