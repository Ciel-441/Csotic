use crate::ipc::types::RiskLevel;
use crate::tools::classify_risk;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio::process::Command;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

/// Handle to the command currently running in the interactive terminal,
/// including child PID for cancellation and stdin for interactive input.
pub struct RunningProcess {
    pub pid: u32,
    pub stdin: Option<tokio::process::ChildStdin>,
}

pub type ProcessHandle = Arc<Mutex<Option<RunningProcess>>>;

const COMMAND_TIMEOUT_SECS: u64 = 60;
const MAX_OUTPUT_BYTES: usize = 512 * 1024; // 512KB cap to prevent unbounded RAM growth
const TRUNCATED_NOTE: &str = "[Output truncated at 512KB]\n";

pub async fn handle(
    app: &AppHandle,
    action: &str,
    payload: &serde_json::Value,
    process_handle: &ProcessHandle,
) -> Result<serde_json::Value, String> {
    match action {
        "execute_command" => {
            let project_path = payload
                .get("project_path")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'project_path'")?;
            let command = payload
                .get("command")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'command'")?;
            let approved = payload
                .get("approved")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let sandboxed = payload
                .get("sandboxed")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let stream = payload
                .get("stream")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let risk = classify_risk(command);
            match risk {
                RiskLevel::Critical => {
                    if !approved {
                        return Err(format!("Permission denied: '{}' is classified as Critical risk. Re-call with approved: true to proceed.", command));
                    }
                }
                RiskLevel::High if !approved => {
                    return Err(format!("Permission denied: '{}' is classified as High risk. Re-call with approved: true to proceed.", command));
                }
                _ => {}
            }

            if sandboxed {
                let _ = app.emit(
                    "terminal-output",
                    serde_json::json!({ "text": format!("❯ [sandboxed] {}", command) }),
                );
                match crate::services::sandbox::run_in_sandbox(command, project_path) {
                    Ok(out) => {
                        for line in out.lines() {
                            crate::services::runtime::ingest_log(line);
                            let _ =
                                app.emit("terminal-output", serde_json::json!({ "text": line }));
                        }
                        return Ok(serde_json::json!({
                            "stdout": out.clone(),
                            "output": out,
                            "exit_code": 0,
                            "sandboxed": true
                        }));
                    }
                    Err(e) => {
                        let _ = app.emit("terminal-output", serde_json::json!({ "text": format!("Sandbox execution error: {}", e) }));
                        return Err(e);
                    }
                }
            }

            execute_command(app, project_path, command, stream, process_handle).await
        }
        "send_input" => {
            let input = payload.get("input").and_then(|v| v.as_str()).unwrap_or("");
            let mut h = process_handle.lock().await;
            if let Some(ref mut proc) = *h {
                if let Some(ref mut stdin) = proc.stdin {
                    let trimmed = input.trim_end_matches(['\r', '\n']);
                    let mut bytes = trimmed.as_bytes().to_vec();
                    #[cfg(windows)]
                    bytes.extend_from_slice(b"\r\n");
                    #[cfg(not(windows))]
                    bytes.push(b'\n');
                    stdin
                        .write_all(&bytes)
                        .await
                        .map_err(|e| format!("Failed to write to stdin: {e}"))?;
                    stdin
                        .flush()
                        .await
                        .map_err(|e| format!("Failed to flush stdin: {e}"))?;
                    return Ok(serde_json::json!({ "sent": true }));
                }
            }
            Err("No active interactive process with open stdin".to_string())
        }
        "cancel_command" => {
            let proc = process_handle.lock().await.take();
            if let Some(proc) = proc {
                kill_tree(proc.pid).await;
                Ok(serde_json::json!({ "cancelled": true }))
            } else {
                Ok(serde_json::json!({ "cancelled": false }))
            }
        }
        _ => Err(format!("Unknown terminal action: {action}")),
    }
}

/// Builds the platform shell invocation for a command line.
fn shell_command(command: &str, dir: &Path, interactive: bool) -> Command {
    #[cfg(windows)]
    let mut cmd = {
        let mut c = Command::new("cmd");
        // `/S /C "<line>"` makes cmd run the line verbatim, so quoted arguments survive.
        c.raw_arg(format!("/S /C \"{command}\""));
        c.creation_flags(0x08000000); // CREATE_NO_WINDOW: hides the console window popup
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = Command::new("sh");
        c.arg("-c").arg(command);
        c.process_group(0); // own process group so Stop can kill the whole tree
        c
    };
    // Ensure runtimes like Python and Node flush stdout without buffering prompts
    cmd.env("PYTHONUNBUFFERED", "1");
    cmd.current_dir(dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if interactive {
        cmd.stdin(Stdio::piped());
    } else {
        cmd.stdin(Stdio::null());
    }
    cmd
}

/// Kills a process and everything it spawned (`npm run dev` -> node -> ...).
async fn kill_tree(pid: u32) {
    #[cfg(windows)]
    let mut killer = {
        let mut c = Command::new("taskkill");
        c.args(["/PID", &pid.to_string(), "/T", "/F"]);
        c.creation_flags(0x08000000);
        c
    };
    #[cfg(not(windows))]
    let mut killer = {
        let mut c = Command::new("kill");
        c.args(["-TERM", "--", &format!("-{pid}")]);
        c
    };
    let _ = killer
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await;
}

/// Reads a pipe in chunks until EOF, streaming each line or unbuffered prompt cleanly in real time.
async fn read_stream<R: AsyncRead + Unpin>(mut stream: R, app: Option<AppHandle>) -> String {
    let mut buf = [0u8; 4096];
    let mut out = String::with_capacity(4096);
    let mut line_buf = Vec::with_capacity(512);

    loop {
        let n = if !line_buf.is_empty() && app.is_some() {
            // If we have an incomplete line (prompt), wait up to 100ms for following bytes.
            // If 100ms expires with no new bytes, the process is waiting for user input,
            // so we emit the accumulated prompt cleanly!
            match tokio::time::timeout(Duration::from_millis(100), stream.read(&mut buf)).await {
                Ok(Ok(0)) | Ok(Err(_)) => break,
                Ok(Ok(n)) => n,
                Err(_) => {
                    // 100ms timeout: no more bytes coming right now; program is blocked waiting on stdin.
                    let decoded = String::from_utf8_lossy(&line_buf);
                    let prompt = decoded.trim_end_matches(['\r', '\n']);
                    if !prompt.is_empty() {
                        if let Some(ref app_handle) = app {
                            let _ = app_handle
                                .emit("terminal-output", serde_json::json!({ "text": prompt }));
                        }
                    }
                    if out.len() + prompt.len() < MAX_OUTPUT_BYTES {
                        out.push_str(prompt);
                    }
                    line_buf.clear();
                    continue;
                }
            }
        } else {
            match stream.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            }
        };

        let chunk = &buf[..n];
        for &b in chunk {
            if b == b'\n' {
                let decoded = String::from_utf8_lossy(&line_buf);
                let line = decoded.trim_end_matches(['\r', '\n']);
                crate::services::runtime::ingest_log(line);
                if let Some(app) = &app {
                    let _ = app.emit("terminal-output", serde_json::json!({ "text": line }));
                }
                if out.len() + line.len() < MAX_OUTPUT_BYTES {
                    out.push_str(line);
                    out.push('\n');
                } else if !out.ends_with(TRUNCATED_NOTE) {
                    out.push_str(TRUNCATED_NOTE);
                }
                line_buf.clear();
            } else {
                line_buf.push(b);
            }
        }
    }

    if !line_buf.is_empty() {
        let decoded = String::from_utf8_lossy(&line_buf);
        let line = decoded.trim_end_matches(['\r', '\n']);
        if !line.is_empty() {
            crate::services::runtime::ingest_log(line);
            if let Some(app) = &app {
                let _ = app.emit("terminal-output", serde_json::json!({ "text": line }));
            }
            if out.len() + line.len() < MAX_OUTPUT_BYTES {
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    out
}

/// Waits briefly for a reader task. A detached grandchild can hold the pipe open after the
/// command itself exited; don't hang the caller on it.
async fn drain(task: JoinHandle<String>) -> String {
    tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default()
}

/// Runs a shell command. `stream = true` is the interactive terminal: output is streamed as
/// `terminal-output` events, stdin is piped for interactive input, and the PID is registered for `cancel_command`.
/// `stream = false` is a silent probe (version checks etc.) with a 60s timeout.
pub async fn execute_command(
    app: &AppHandle,
    project_path: &str,
    command: &str,
    stream: bool,
    process_handle: &ProcessHandle,
) -> Result<serde_json::Value, String> {
    let target_dir = if project_path.is_empty() || project_path == "." {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    } else {
        let dir = PathBuf::from(project_path);
        if !dir.is_dir() {
            return Err(format!("Directory not found: {project_path}"));
        }
        dir
    };

    let unbuffer_header = {
        let temp_dir = std::env::temp_dir();
        let h_path = temp_dir.join("csotic_unbuffer.h");
        if !h_path.exists() {
            let _ = std::fs::write(
                &h_path,
                r#"#include <stdio.h>
#ifdef __cplusplus
extern "C" {
#endif
__attribute__((constructor)) static void __csotic_unbuffer(void) {
    setvbuf(stdout, NULL, _IONBF, 0);
    setvbuf(stderr, NULL, _IONBF, 0);
}
#ifdef __cplusplus
}
#endif
"#,
            );
        }
        h_path.to_string_lossy().replace('\\', "/")
    };

    let effective_command = if stream {
        let flag = format!(" -include \"{}\" ", unbuffer_header);
        let compilers = [
            "gcc.exe",
            "gcc",
            "g++.exe",
            "g++",
            "clang.exe",
            "clang",
            "clang++.exe",
            "clang++",
        ];
        let mut modified = None;
        for comp in compilers {
            for prefix in ["", " "] {
                let pat = format!("{prefix}{comp} ");
                if let Some(pos) = command.find(&pat) {
                    let mut s = command.to_string();
                    s.insert_str(pos + pat.len(), &flag);
                    modified = Some(s);
                    break;
                }
            }
            if modified.is_some() {
                break;
            }
        }
        modified.unwrap_or_else(|| command.to_string())
    } else {
        command.to_string()
    };

    let start_time = std::time::Instant::now();
    let mut child = shell_command(&effective_command, &target_dir, stream)
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {e}"))?;
    let pid = child.id();
    let child_stdin = if stream { child.stdin.take() } else { None };

    if stream {
        if let Some(p) = pid {
            *process_handle.lock().await = Some(RunningProcess {
                pid: p,
                stdin: child_stdin,
            });
        }
    }

    let emit_to = stream.then(|| app.clone());
    let stdout_task = tokio::spawn(read_stream(
        child.stdout.take().ok_or("Failed to open stdout")?,
        emit_to.clone(),
    ));
    let stderr_task = tokio::spawn(read_stream(
        child.stderr.take().ok_or("Failed to open stderr")?,
        emit_to,
    ));

    let mut timed_out = false;
    let status = if stream {
        child.wait().await
    } else {
        match tokio::time::timeout(Duration::from_secs(COMMAND_TIMEOUT_SECS), child.wait()).await {
            Ok(status) => status,
            Err(_) => {
                timed_out = true;
                if let Some(pid) = pid {
                    kill_tree(pid).await;
                }
                child.wait().await
            }
        }
    }
    .map_err(|e| format!("Wait error: {e}"))?;

    // cancel_command takes the process out of the handle before killing, so a missing or mismatched PID means Stop.
    let cancelled = stream && {
        let mut h = process_handle.lock().await;
        if let Some(proc) = h.as_ref() {
            if Some(proc.pid) == pid {
                *h = None;
                false
            } else {
                true
            }
        } else {
            true
        }
    };

    let stdout = drain(stdout_task).await;
    let mut stderr = drain(stderr_task).await;
    if timed_out {
        stderr.push_str("Command timed out after 60 seconds");
    }

    let exit_code = status.code().unwrap_or(-1);
    let duration_ms = start_time.elapsed().as_millis() as u64;

    if stream && !cancelled {
        let duration_str = if duration_ms < 1000 {
            format!("{}ms", duration_ms)
        } else {
            format!("{:.2}s", duration_ms as f64 / 1000.0)
        };
        let text = if exit_code == 0 {
            format!("✨ [Finished in {}]", duration_str)
        } else {
            format!(
                "⚠️ [Process exited with code {} in {}]",
                exit_code, duration_str
            )
        };
        let _ = app.emit("terminal-output", serde_json::json!({ "text": text }));
    }

    Ok(serde_json::json!({
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "timed_out": timed_out,
        "cancelled": cancelled,
        "duration_ms": duration_ms,
    }))
}

/// For agent tool use — run command and return simple text result
pub async fn run_command_simple(
    project_path: &str,
    command: &str,
    _permission: &str,
    _process_handle: &ProcessHandle,
) -> Result<String, String> {
    let risk = classify_risk(command);
    match risk {
        RiskLevel::Critical | RiskLevel::High => {
            return Err(format!("Command '{}' requires explicit user approval (risk: {:?}). Run it from the interactive terminal to approve it.", command, risk));
        }
        _ => {}
    }

    let mut child = shell_command(command, Path::new(project_path), false)
        .spawn()
        .map_err(|e| format!("Failed to spawn command: {e}"))?;
    let pid = child.id();

    let stdout_task = tokio::spawn(read_stream(
        child.stdout.take().ok_or("Failed to open stdout")?,
        None,
    ));
    let stderr_task = tokio::spawn(read_stream(
        child.stderr.take().ok_or("Failed to open stderr")?,
        None,
    ));

    let status =
        match tokio::time::timeout(Duration::from_secs(COMMAND_TIMEOUT_SECS), child.wait()).await {
            Ok(status) => status.map_err(|e| format!("Wait error: {e}"))?,
            Err(_) => {
                if let Some(pid) = pid {
                    kill_tree(pid).await;
                }
                let _ = child.wait().await;
                return Err("Command timed out after 60 seconds".to_string());
            }
        };

    let stdout = drain(stdout_task).await;
    let stderr = drain(stderr_task).await;
    let exit_code = status.code().unwrap_or(-1);
    // Always return Ok so the agent model can read the output and act on errors
    Ok(format!(
        "Exit code: {exit_code}\nstdout:\n{stdout}\nstderr:\n{stderr}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn quoted_args_reach_the_command_and_exit_code_is_reported() {
        let handle: ProcessHandle = Arc::new(Mutex::new(None));
        let out = run_command_simple(".", "echo \"a b\"", "", &handle)
            .await
            .expect("echo runs");
        assert!(out.contains("a b"), "{out}");
        assert!(!out.contains("\\\""), "quotes were mangled: {out}");

        let out = run_command_simple(".", "exit 3", "", &handle)
            .await
            .expect("exit runs");
        assert!(out.starts_with("Exit code: 3"), "{out}");
    }
}
