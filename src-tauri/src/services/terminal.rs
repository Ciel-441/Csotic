use crate::tools::classify_risk;
use crate::ipc::types::RiskLevel;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::process::Command;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tauri::{AppHandle, Emitter};

pub type ProcessHandle = Arc<Mutex<Option<tokio::process::Child>>>;

const COMMAND_TIMEOUT_SECS: u64 = 60;

pub async fn handle(app: &AppHandle, action: &str, payload: &serde_json::Value, process_handle: &ProcessHandle) -> Result<serde_json::Value, String> {
    match action {
        "execute_command" => {
            let project_path = payload.get("project_path").and_then(|v| v.as_str())
                .ok_or("Missing 'project_path'")?;
            let command = payload.get("command").and_then(|v| v.as_str())
                .ok_or("Missing 'command'")?;
            let approved = payload.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);

            let risk = classify_risk(command);
            match risk {
                RiskLevel::Critical => {
                    if !approved {
                        return Err(format!("Permission denied: '{}' is classified as Critical risk. Re-call with approved: true to proceed.", command));
                    }
                }
                RiskLevel::High => {
                    if !approved {
                        return Err(format!("Permission denied: '{}' is classified as High risk. Re-call with approved: true to proceed.", command));
                    }
                }
                _ => {}
            }

            execute_command(app, project_path, command, process_handle).await
        }
        "cancel_command" => {
            let mut handle = process_handle.lock().await;
            if let Some(ref mut child) = *handle {
                let _ = child.kill().await;
                *handle = None;
                Ok(serde_json::json!({ "cancelled": true }))
            } else {
                Ok(serde_json::json!({ "cancelled": false }))
            }
        }
        _ => Err(format!("Unknown terminal action: {action}")),
    }
}

pub async fn execute_command(app: &AppHandle, project_path: &str, command: &str, process_handle: &ProcessHandle) -> Result<serde_json::Value, String> {
    let shell = if cfg!(windows) { "cmd" } else { "sh" };
    let flag = if cfg!(windows) { "/C" } else { "-c" };

    let start_time = std::time::Instant::now();

    let target_dir = if project_path.is_empty() || project_path == "." || !std::path::Path::new(project_path).exists() {
        std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."))
    } else {
        std::path::PathBuf::from(project_path)
    };

    let _ = app.emit("terminal-output", serde_json::json!({ "text": format!("❯ {}", command) }));

    let mut child = Command::new(shell)
        .arg(flag)
        .arg(command)
        .current_dir(&target_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    let stdout_stream = child.stdout.take().ok_or("Failed to open stdout")?;
    let stderr_stream = child.stderr.take().ok_or("Failed to open stderr")?;

    let app_stdout = app.clone();
    let stdout_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stdout_stream).lines();
        let mut full_output = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_stdout.emit("terminal-output", serde_json::json!({ "text": line }));
            full_output.push_str(&line);
            full_output.push('\n');
        }
        full_output
    });

    let app_stderr = app.clone();
    let stderr_handle = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr_stream).lines();
        let mut full_output = String::new();
        while let Ok(Some(line)) = reader.next_line().await {
            let _ = app_stderr.emit("terminal-output", serde_json::json!({ "text": line }));
            full_output.push_str(&line);
            full_output.push('\n');
        }
        full_output
    });

    // Store child in process_handle so cancel_command can reach it
    {
        let mut h = process_handle.lock().await;
        *h = Some(child);
    }

    // Wait on the child through the shared handle
    let timeout = tokio::time::timeout(
        std::time::Duration::from_secs(COMMAND_TIMEOUT_SECS),
        async {
            loop {
                let mut h = process_handle.lock().await;
                if let Some(ref mut child) = *h {
                    match child.try_wait() {
                        Ok(Some(status)) => return Ok(status),
                        Ok(None) => {
                            drop(h);
                            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        }
                        Err(e) => return Err(format!("Wait error: {e}")),
                    }
                } else {
                    // Child was taken (cancelled)
                    return Err("Command was cancelled".to_string());
                }
            }
        }
    ).await;

    match timeout {
        Ok(Ok(status)) => {
            let stdout = stdout_handle.await.unwrap_or_default();
            let stderr = stderr_handle.await.unwrap_or_default();
            let exit_code = status.code().unwrap_or(-1);
            { let mut h = process_handle.lock().await; *h = None; }
            let duration_ms = start_time.elapsed().as_millis() as u64;
            let duration_str = if duration_ms < 1000 {
                format!("{}ms", duration_ms)
            } else {
                format!("{:.2}s", duration_ms as f64 / 1000.0)
            };

            if exit_code == 0 {
                let _ = app.emit("terminal-output", serde_json::json!({ "text": format!("✨ [Finished in {}]", duration_str) }));
            } else {
                let _ = app.emit("terminal-output", serde_json::json!({ "text": format!("⚠️ [Process exited with code {} in {}]", exit_code, duration_str) }));
            }

            Ok(serde_json::json!({
                "stdout": stdout,
                "stderr": stderr,
                "exit_code": exit_code,
                "timed_out": false,
                "duration_ms": duration_ms,
            }))
        }
        Ok(Err(e)) => {
            { let mut h = process_handle.lock().await; *h = None; }
            Err(e)
        }
        Err(_) => {
            // Timeout — kill the process
            let mut h = process_handle.lock().await;
            if let Some(ref mut child) = *h {
                let _ = child.kill().await;
            }
            *h = None;
            drop(h);
            let duration_ms = start_time.elapsed().as_millis() as u64;
            let _ = app.emit("terminal-output", serde_json::json!({ "text": "⚠️ [Command timed out after 60 seconds]".to_string() }));
            Ok(serde_json::json!({
                "stdout": "",
                "stderr": "Command timed out after 60 seconds",
                "exit_code": -1,
                "timed_out": true,
                "duration_ms": duration_ms,
            }))
        }
    }
}

/// For agent tool use — run command and return simple text result
pub async fn run_command_simple(project_path: &str, command: &str, _permission: &str, process_handle: &ProcessHandle) -> Result<String, String> {
    let risk = classify_risk(command);
    match risk {
        RiskLevel::Critical | RiskLevel::High => {
            return Err(format!("Command '{}' requires explicit user approval (risk: {:?}). Run it from the interactive terminal to approve it.", command, risk));
        }
        _ => {}
    }

    let shell = if cfg!(windows) { "cmd" } else { "sh" };
    let flag = if cfg!(windows) { "/C" } else { "-c" };

    let mut child = Command::new(shell)
        .arg(flag)
        .arg(command)
        .current_dir(project_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {e}"))?;

    let mut stdout_stream = child.stdout.take().ok_or("Failed to open stdout")?;
    let mut stderr_stream = child.stderr.take().ok_or("Failed to open stderr")?;

    let stdout_handle = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stdout_stream.read_to_end(&mut buf).await;
        buf
    });
    let stderr_handle = tokio::spawn(async move {
        let mut buf = Vec::new();
        let _ = stderr_stream.read_to_end(&mut buf).await;
        buf
    });

    // Store child so it can be cancelled
    {
        let mut h = process_handle.lock().await;
        *h = Some(child);
    }

    let timeout_result = tokio::time::timeout(
        std::time::Duration::from_secs(COMMAND_TIMEOUT_SECS),
        async {
            loop {
                let mut h = process_handle.lock().await;
                if let Some(ref mut child) = *h {
                    match child.try_wait() {
                        Ok(Some(status)) => return Ok(status),
                        Ok(None) => {
                            drop(h);
                            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        }
                        Err(e) => return Err(format!("Wait error: {e}")),
                    }
                } else {
                    return Err("Command was cancelled".to_string());
                }
            }
        }
    ).await;

    // Clear handle
    { let mut h = process_handle.lock().await; *h = None; }

    match timeout_result {
        Ok(Ok(status)) => {
            let stdout_bytes = stdout_handle.await.unwrap_or_default();
            let stderr_bytes = stderr_handle.await.unwrap_or_default();
            let stdout = String::from_utf8_lossy(&stdout_bytes);
            let stderr = String::from_utf8_lossy(&stderr_bytes);
            let exit_code = status.code().unwrap_or(-1);
            // Always return Ok so the agent model can read the output and act on errors
            Ok(format!("Exit code: {exit_code}\nstdout:\n{stdout}\nstderr:\n{stderr}"))
        }
        Ok(Err(e)) => Err(e),
        Err(_) => Err("Command timed out after 60 seconds".to_string()),
    }
}
