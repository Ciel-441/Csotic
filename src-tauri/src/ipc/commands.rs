use std::time::Instant;
use tauri::Manager;
use crate::ipc::types::{ErrorCode, IpcResponse, IpcError};
use crate::services;
use crate::AppState;

#[tauri::command]
pub async fn ipc_request(
    service: String,
    action: String,
    payload: serde_json::Value,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<IpcResponse, ()> {
    let start = Instant::now();

    // Catch errors inside and convert to IpcResponse
    let result = execute_dispatch(service.clone(), action.clone(), payload, &app, &state).await;
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(data) => {
            services::logger::ForgeLogger::log_event(
                services::logger::Subsystem::IPC,
                &format!("IPC Request Success: {service}.{action}"),
                Some(start.elapsed()),
                None,
            );
            Ok(IpcResponse {
                success: true,
                data,
                error: None,
                duration_ms,
            })
        }
        Err((code, msg)) => {
            services::logger::ForgeLogger::log_event(
                services::logger::Subsystem::IPC,
                &format!("IPC Request Error: {service}.{action}"),
                Some(start.elapsed()),
                Some(&msg),
            );
            Ok(IpcResponse {
                success: false,
                data: serde_json::Value::Null,
                error: Some(IpcError {
                    code,
                    message: msg,
                    details: None,
                }),
                duration_ms,
            })
        }
    }
}

async fn execute_dispatch(
    service: String,
    action: String,
    payload: serde_json::Value,
    app: &tauri::AppHandle,
    state: &AppState,
) -> Result<serde_json::Value, (ErrorCode, String)> {
    match service.as_str() {
        "workspace" => {
            let response = services::workspace::handle(&action, &payload, &state.db)
                .map_err(|e| (ErrorCode::Internal, e))?;

            // Keep the runtime scope in sync with restored workspace state,
            // not only folders opened during the current process lifetime.
            if action == "open_project" || action == "get_state" || action == "clear_active_project" {
                let project_path = response.get("active_project")
                    .and_then(|project| project.get("path"))
                    .and_then(|path| path.as_str())
                    .map(str::to_owned);
                let mut app_path = state.active_project_path.lock().map_err(|e| {
                    (ErrorCode::Internal, format!("Failed to lock active project path: {e}"))
                })?;
                *app_path = project_path.clone();
                if let Some(path) = project_path.as_deref() {
                    let _ = services::watcher::watch_workspace(path, state.db.clone());
                    let _ = services::truth::WorkspaceTruth::refresh_truth(path, &state.db);
                    if action == "open_project" {
                        services::plugins::load_workspace_plugins(path);
                    }
                }
            }
            Ok(response)
        }
        "filesystem" => {
            let active_path = {
                let path_lock = state.active_project_path.lock().map_err(|e| {
                    (ErrorCode::Internal, format!("Failed to lock active project path: {e}"))
                })?;
                path_lock.clone()
            };
            let permission = payload.get("permission_profile").and_then(|v| v.as_str());
            let response = services::filesystem::handle(&action, &payload, active_path.as_deref(), permission)
                .await
                .map_err(|e| {
                    if e.contains("Permission") {
                        (ErrorCode::Permission, e)
                    } else if e.contains("Validation") {
                        (ErrorCode::Validation, e)
                    } else {
                        (ErrorCode::Filesystem, e)
                    }
                })?;

            if action == "write_file" {
                if let (Some(pp), Some(path), Some(content)) = (
                    active_path.as_deref(),
                    payload.get("path").and_then(|v| v.as_str()),
                    payload.get("content").and_then(|v| v.as_str()),
                ) {
                    services::incremental::on_file_changed(pp, path, content, &state.db);
                }
            } else if action == "delete" {
                if let (Some(pp), Some(path)) = (
                    active_path.as_deref(),
                    payload.get("path").and_then(|v| v.as_str()),
                ) {
                    services::incremental::on_file_deleted(pp, path, &state.db);
                }
            }

            Ok(response)
        }
        "git" => {
            services::git::handle(&action, &payload)
                .map_err(|e| {
                    if e.contains("Permission") {
                        (ErrorCode::Permission, e)
                    } else {
                        (ErrorCode::Process, e)
                    }
                })
        }
        "terminal" => {
            services::terminal::handle(app, &action, &payload, &state.process_handle).await
                .map_err(|e| {
                    if e.contains("Permission") {
                        (ErrorCode::Permission, e)
                    } else {
                        (ErrorCode::Process, e)
                    }
                })
        }
        "models" => {
            services::models::handle(&action, &payload, app, &state.db).await
                .map_err(|e| {
                    if e.contains("unreachable") {
                        (ErrorCode::Network, e)
                    } else {
                        (ErrorCode::Model, e)
                    }
                })
        }
        "agent" => {
            services::agent::handle(app, &action, &payload, &state.process_handle, &state.db).await
                .map_err(|e| (ErrorCode::Internal, e))
        }
        "memory" => {
            services::memory::handle(&action, &payload, &state.db)
                .map_err(|e| (ErrorCode::Internal, e))
        }
        "indexing" => {
            services::indexing::handle(&action, &payload, &state.db)
                .map_err(|e| (ErrorCode::Internal, e))
        }
        "plugins" => {
            services::plugins::handle(&action, &payload).await
                .map_err(|e| (ErrorCode::Internal, e))
        }
        "ext_host" => {
            services::ext_host::handle(&action, &payload, app).await
                .map_err(|e| (ErrorCode::Internal, e))
        }
        "collaboration" => {
            services::collaboration::handle(&action, &payload)
                .map_err(|e| (ErrorCode::Internal, e))
        }
        "symbols" => {
            services::symbols::handle(&action, &payload)
                .map_err(|e| (ErrorCode::Internal, e))
        }
        "system" => {
            services::system::handle(&action, &payload, app).await
                .map_err(|e| (ErrorCode::Internal, e))
        }
        "brain" => {
            services::brain::handle(&action, &payload)
                .map_err(|e| (ErrorCode::Internal, e))
        }
        "project_state" => {
            let active_path_opt = state.active_project_path.lock().ok().and_then(|g| g.clone());
            let project_path = payload.get("project_path").and_then(|v| v.as_str())
                .or(active_path_opt.as_deref())
                .unwrap_or_default();
            let state = services::project_state::ProjectDetector::detect(project_path);
            serde_json::to_value(state).map_err(|e| (ErrorCode::Internal, format!("Serialization error: {e}")))
        }

        "changeset" => {
            match action.as_str() {
                "rollback" => {
                    let project_path = payload.get("project_path").and_then(|v| v.as_str())
                        .ok_or((ErrorCode::Validation, "Missing 'project_path'".to_string()))?;
                    let task_id = payload.get("task_id").and_then(|v| v.as_str())
                        .ok_or((ErrorCode::Validation, "Missing 'task_id'".to_string()))?;
                    let reverted = services::changeset::get_rollback_journal().rollback_task(project_path, task_id, Some(&state.db))
                        .map_err(|e| (ErrorCode::Filesystem, e))?;
                    Ok(serde_json::json!({ "reverted": reverted }))
                }
                _ => Err((ErrorCode::Validation, format!("Unknown changeset action: {action}"))),
            }
        }
        "window" => {
            if let Some(window) = app.get_webview_window("main") {
                match action.as_str() {
                    "minimize" => {
                        let _ = window.minimize();
                        Ok(serde_json::json!({ "minimized": true }))
                    }
                    "maximize" => {
                        let _ = window.maximize();
                        Ok(serde_json::json!({ "maximized": true }))
                    }
                    "unmaximize" => {
                        let _ = window.unmaximize();
                        Ok(serde_json::json!({ "unmaximized": true }))
                    }
                    "toggle_maximize" => {
                        let is_max = window.is_maximized().unwrap_or(false);
                        if is_max {
                            let _ = window.unmaximize();
                        } else {
                            let _ = window.maximize();
                        }
                        Ok(serde_json::json!({ "toggled": true, "maximized": !is_max }))
                    }
                    "close" => {
                        let _ = window.close();
                        Ok(serde_json::json!({ "closed": true }))
                    }
                    "start_dragging" => {
                        let _ = window.start_dragging();
                        Ok(serde_json::json!({ "dragging": true }))
                    }
                    _ => Err((ErrorCode::Validation, format!("Unknown window action: {action}"))),
                }
            } else {
                Err((ErrorCode::Internal, "Main window not found".to_string()))
            }
        }
        "auth" => {
            services::auth::handle_action(&action, &payload).await
        }
        _ => Err((ErrorCode::Validation, format!("Unknown service: {service}"))),
    }
}

