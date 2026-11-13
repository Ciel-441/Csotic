use once_cell::sync::Lazy;
use serde_json::Value;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;

type PendingRequests =
    Arc<Mutex<HashMap<u64, tokio::sync::oneshot::Sender<Result<Value, String>>>>>;

pub struct ExtensionHostManager {
    child: Option<Child>,
    stdin: Option<std::process::ChildStdin>,
    next_id: AtomicU64,
    pending_requests: PendingRequests,
    server_port: Option<u16>,
    workspace_root: Option<String>,
}

impl ExtensionHostManager {
    pub fn new() -> Self {
        Self {
            child: None,
            stdin: None,
            next_id: AtomicU64::new(1),
            pending_requests: Arc::new(Mutex::new(HashMap::new())),
            server_port: None,
            workspace_root: None,
        }
    }

    pub fn is_running(&mut self) -> bool {
        if let Some(child) = &mut self.child {
            match child.try_wait() {
                Ok(None) => true,
                _ => {
                    self.child = None;
                    self.stdin = None;
                    false
                }
            }
        } else {
            false
        }
    }

    pub fn ensure_started(
        &mut self,
        app: &tauri::AppHandle,
        workspace_root: Option<&str>,
    ) -> Result<u16, String> {
        if self.is_running() {
            if let Some(port) = self.server_port {
                return Ok(port);
            }
        }

        let root = workspace_root
            .map(|s| s.to_string())
            .or_else(|| self.workspace_root.clone())
            .unwrap_or_else(|| ".".to_string());
        self.workspace_root = Some(root.clone());

        // Find scripts/extHost.cjs relative to project root or current working dir
        let script_candidates = vec![
            PathBuf::from("scripts").join("extHost.cjs"),
            PathBuf::from("..").join("scripts").join("extHost.cjs"),
        ];

        let script_path = script_candidates
            .into_iter()
            .find(|p| p.exists())
            .unwrap_or_else(|| PathBuf::from("scripts").join("extHost.cjs"));

        let mut cmd = Command::new("node");
        cmd.arg("--max-old-space-size=128");
        cmd.arg(&script_path);
        cmd.stdin(Stdio::piped());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW: completely hides cmd/console window popup
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn Extension Host (Node.js): {e}"))?;

        let stdin = child.stdin.take().ok_or("Failed to capture child stdin")?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Failed to capture child stdout")?;

        let pending_map = self.pending_requests.clone();
        let app_handle = app.clone();

        // Spawn thread to read stdout lines from the child process
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                if let Ok(json) = serde_json::from_str::<Value>(trimmed) {
                    // Check if it's a response to a pending request
                    if let Some(id) = json.get("id").and_then(|v| v.as_u64()) {
                        let mut map = match pending_map.lock() {
                            Ok(guard) => guard,
                            Err(poisoned) => poisoned.into_inner(),
                        };
                        if let Some(sender) = map.remove(&id) {
                            if let Some(err) = json.get("error") {
                                let msg = err
                                    .get("message")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("RPC Error");
                                let _ = sender.send(Err(msg.to_string()));
                            } else {
                                let result = json.get("result").cloned().unwrap_or(Value::Null);
                                let _ = sender.send(Ok(result));
                            }
                        }
                    } else if let Some(method) = json.get("method").and_then(|v| v.as_str()) {
                        // It's a notification/event from extHost
                        let params = json.get("params").cloned().unwrap_or(Value::Null);
                        match method {
                            "webview/onPostMessage" => {
                                let _ = app_handle.emit("ext-host:message", &params);
                            }
                            "webview/onSetHtml" => {
                                let _ = app_handle.emit("ext-host:set-html", &params);
                            }
                            "extHost/log" => {
                                let _ = app_handle.emit("ext-host:log", &params);
                            }
                            _ => {
                                let _ = app_handle.emit(
                                    "ext-host:event",
                                    serde_json::json!({
                                        "method": method,
                                        "params": params,
                                    }),
                                );
                            }
                        }
                    }
                }
            }
        });

        self.child = Some(child);
        self.stdin = Some(stdin);

        // Send extHost/init request synchronously with short timeout
        let init_req = serde_json::json!({
            "workspaceRoot": root,
        });

        let res = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(self.send_request("extHost/init", init_req))
        })?;

        let port = res
            .get("port")
            .and_then(|v| v.as_u64())
            .map(|p| p as u16)
            .unwrap_or(0);
        self.server_port = Some(port);
        Ok(port)
    }

    pub async fn send_request(&mut self, method: &str, params: Value) -> Result<Value, String> {
        let stdin = self.stdin.as_mut().ok_or("Extension host is not running")?;
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);

        let (tx, rx) = tokio::sync::oneshot::channel();
        {
            let mut map = match self.pending_requests.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            map.insert(id, tx);
        }

        let msg = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        let mut line = serde_json::to_string(&msg).map_err(|e| e.to_string())?;
        line.push('\n');

        stdin
            .write_all(line.as_bytes())
            .map_err(|e| format!("Failed to write to extHost stdin: {e}"))?;
        stdin
            .flush()
            .map_err(|e| format!("Failed to flush extHost stdin: {e}"))?;

        match tokio::time::timeout(Duration::from_secs(15), rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("Extension host closed connection prematurely".to_string()),
            Err(_) => {
                let mut map = match self.pending_requests.lock() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                map.remove(&id);
                Err(format!("Extension host RPC timeout calling {method}"))
            }
        }
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
        }
        self.stdin = None;
        self.server_port = None;
    }
}

pub static EXT_HOST: Lazy<tokio::sync::Mutex<ExtensionHostManager>> =
    Lazy::new(|| tokio::sync::Mutex::new(ExtensionHostManager::new()));

pub async fn handle(
    action: &str,
    payload: &Value,
    app: &tauri::AppHandle,
) -> Result<Value, String> {
    match action {
        "status" => {
            let mut host = EXT_HOST.lock().await;
            let running = host.is_running();
            Ok(serde_json::json!({ "running": running }))
        }
        "start" => {
            let root = payload.get("workspace_root").and_then(|v| v.as_str());
            let mut host = EXT_HOST.lock().await;
            let port = host.ensure_started(app, root)?;
            Ok(serde_json::json!({ "success": true, "port": port }))
        }
        "activate_extension" => {
            let ext_id = payload
                .get("extension_id")
                .and_then(|v| v.as_str())
                .ok_or("Missing extension_id")?;
            let root = payload.get("workspace_root").and_then(|v| v.as_str());

            let mut host = EXT_HOST.lock().await;
            host.ensure_started(app, root)?;
            let res = host
                .send_request(
                    "extHost/activate",
                    serde_json::json!({ "extensionId": ext_id }),
                )
                .await?;
            Ok(res)
        }
        "resolve_webview" => {
            let view_id = payload
                .get("view_id")
                .and_then(|v| v.as_str())
                .ok_or("Missing view_id")?;
            let ext_id = payload.get("extension_id").and_then(|v| v.as_str());
            let root = payload.get("workspace_root").and_then(|v| v.as_str());

            let mut host = EXT_HOST.lock().await;
            host.ensure_started(app, root)?;
            if let Some(id) = ext_id {
                let _ = host
                    .send_request("extHost/activate", serde_json::json!({ "extensionId": id }))
                    .await?;
            }
            let res = host
                .send_request(
                    "extHost/resolveWebview",
                    serde_json::json!({ "viewId": view_id }),
                )
                .await?;
            Ok(res)
        }
        "post_message" => {
            let view_id = payload
                .get("view_id")
                .and_then(|v| v.as_str())
                .ok_or("Missing view_id")?;
            let message = payload.get("message").cloned().unwrap_or(Value::Null);

            let mut host = EXT_HOST.lock().await;
            let res = host
                .send_request(
                    "webview/postMessage",
                    serde_json::json!({ "viewId": view_id, "message": message }),
                )
                .await?;
            Ok(res)
        }
        "stop" => {
            let mut host = EXT_HOST.lock().await;
            host.stop();
            Ok(serde_json::json!({ "stopped": true }))
        }
        _ => Err(format!("Unknown ext_host action: {action}")),
    }
}
