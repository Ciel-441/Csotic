use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceState {
    pub id: String,
    pub name: String,
    pub active_project_id: Option<String>,
    pub active_project: Option<ProjectInfo>,
    pub open_files: Vec<String>,
    pub active_model: Option<String>,
    pub background_model: Option<String>,
    pub terminal_sessions: Vec<String>,
    pub layout: LayoutState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectInfo {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutState {
    pub sidebar_visible: bool,
    pub sidebar_width: u32,
    pub bottom_dock_visible: bool,
    pub bottom_dock_height: u32,
    pub right_panel_visible: bool,
    pub right_panel_width: u32,
}

impl Default for LayoutState {
    fn default() -> Self {
        Self {
            sidebar_visible: true,
            sidebar_width: 260,
            bottom_dock_visible: true,
            bottom_dock_height: 240,
            right_panel_visible: true,
            right_panel_width: 320,
        }
    }
}

impl Default for WorkspaceState {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Default Workspace".to_string(),
            active_project_id: None,
            active_project: None,
            open_files: Vec::new(),
            active_model: None,
            background_model: None,
            terminal_sessions: Vec::new(),
            layout: LayoutState::default(),
        }
    }
}

fn load_workspace_or_default(conn: &Connection) -> WorkspaceState {
    let mut stmt = match conn.prepare("SELECT state_json FROM workspaces LIMIT 1") {
        Ok(s) => s,
        Err(_) => return WorkspaceState::default(),
    };
    let state_json: Option<String> = stmt.query_row([], |row| row.get(0)).ok();

    if let Some(json_str) = state_json {
        if let Ok(state) = serde_json::from_str::<WorkspaceState>(&json_str) {
            return state;
        }
    }
    WorkspaceState::default()
}

fn save_workspace_state(conn: &Connection, state: &WorkspaceState) -> Result<(), String> {
    let json_str = serde_json::to_string(state).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR REPLACE INTO workspaces (id, name, active_project_id, state_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![state.id, state.name, state.active_project_id, json_str, now]
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn handle(
    action: &str,
    payload: &serde_json::Value,
    db: &Mutex<Connection>,
) -> Result<serde_json::Value, String> {
    let conn = db.lock().map_err(|e| format!("DB lock error: {e}"))?;

    match action {
        "get_state" => {
            let state = load_workspace_or_default(&conn);
            serde_json::to_value(&state).map_err(|e| e.to_string())
        }
        "open_project" => {
            let path = payload
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Missing 'path' in payload".to_string())?;

            let clean_raw = if let Some(rest) = path.strip_prefix(r"\\?\") {
                rest
            } else if let Some(rest) = path.strip_prefix("//?/") {
                rest
            } else {
                path
            };

            let canonical_path = Path::new(clean_raw)
                .canonicalize()
                .map_err(|_| format!("Path does not exist: {path}"))?;
            if !canonical_path.is_dir() {
                return Err(format!("Project path must be a directory: {path}"));
            }

            let name = canonical_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Unknown".to_string());

            let clean_canonical = {
                let s = canonical_path.to_string_lossy();
                if let Some(rest) = s.strip_prefix(r"\\?\") {
                    rest.to_string()
                } else if let Some(rest) = s.strip_prefix("//?/") {
                    rest.to_string()
                } else {
                    s.to_string()
                }
            };

            let project = ProjectInfo {
                name: name.clone(),
                path: clean_canonical.clone(),
            };

            // Detect project metadata
            let pstate = crate::services::project_state::ProjectDetector::detect(&clean_canonical);
            let project_id = crate::services::filesystem::compute_project_id(&clean_canonical);
            let now = chrono::Utc::now().to_rfc3339();
            let git_root = if pstate.is_git {
                Some(clean_canonical.clone())
            } else {
                None
            };

            let raw_tree = format!(
                "files={}:dirs={}:manifests={}:entries={}",
                pstate.file_count,
                pstate.directory_count,
                pstate.important_files.join(","),
                pstate.entry_points.join(",")
            );
            let content_fingerprint = format!(
                "tree_v1:{}",
                crate::services::filesystem::compute_sha256(&raw_tree)
            );

            // Insert or update projects table as single canonical source of truth
            let _ = conn.execute(
                "INSERT INTO projects (
                    id, root_path, canonical_path, name, project_type, package_manager, git_root,
                    content_fingerprint, created_at, updated_at, last_seen_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                ON CONFLICT(root_path) DO UPDATE SET
                    name = excluded.name,
                    project_type = excluded.project_type,
                    package_manager = excluded.package_manager,
                    content_fingerprint = excluded.content_fingerprint,
                    updated_at = excluded.updated_at,
                    last_seen_at = excluded.last_seen_at",
                rusqlite::params![
                    project_id,
                    clean_canonical,
                    clean_canonical,
                    name,
                    pstate.project_type_name,
                    pstate.package_manager,
                    git_root,
                    content_fingerprint,
                    now,
                    now,
                    now
                ],
            );

            let mut state = load_workspace_or_default(&conn);
            state.active_project_id = Some(project_id.clone());
            state.active_project = Some(project.clone());
            save_workspace_state(&conn, &state)?;

            serde_json::to_value(&state).map_err(|e| e.to_string())
        }
        "clear_active_project" => {
            let mut state = load_workspace_or_default(&conn);
            state.active_project_id = None;
            state.active_project = None;
            state.open_files.clear();
            save_workspace_state(&conn, &state)?;
            serde_json::to_value(&state).map_err(|e| e.to_string())
        }
        "get_layout" => {
            let state = load_workspace_or_default(&conn);
            serde_json::to_value(&state.layout).map_err(|e| e.to_string())
        }
        "update_layout" => {
            let mut state = load_workspace_or_default(&conn);

            if let Some(visible) = payload.get("sidebar_visible").and_then(|v| v.as_bool()) {
                state.layout.sidebar_visible = visible;
            }
            if let Some(width) = payload.get("sidebar_width").and_then(|v| v.as_u64()) {
                state.layout.sidebar_width = width as u32;
            }
            if let Some(visible) = payload.get("bottom_dock_visible").and_then(|v| v.as_bool()) {
                state.layout.bottom_dock_visible = visible;
            }
            if let Some(height) = payload.get("bottom_dock_height").and_then(|v| v.as_u64()) {
                state.layout.bottom_dock_height = height as u32;
            }
            if let Some(visible) = payload.get("right_panel_visible").and_then(|v| v.as_bool()) {
                state.layout.right_panel_visible = visible;
            }
            if let Some(width) = payload.get("right_panel_width").and_then(|v| v.as_u64()) {
                state.layout.right_panel_width = width as u32;
            }

            save_workspace_state(&conn, &state)?;
            serde_json::to_value(&state.layout).map_err(|e| e.to_string())
        }
        "get_recent_projects" => {
            let mut stmt = conn.prepare("SELECT name, root_path, id, project_type, last_seen_at FROM projects ORDER BY last_seen_at DESC LIMIT 10")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok(serde_json::json!({
                        "name": row.get::<_, String>(0)?,
                        "path": row.get::<_, String>(1)?,
                        "id": row.get::<_, String>(2)?,
                        "type": row.get::<_, String>(3)?,
                        "last_seen_at": row.get::<_, String>(4)?,
                    }))
                })
                .map_err(|e| e.to_string())?;

            let projects: Vec<serde_json::Value> = rows.flatten().collect();
            Ok(serde_json::json!({ "projects": projects }))
        }
        "save_state" => {
            let mut state = load_workspace_or_default(&conn);
            if let Some(open_files) = payload.get("open_files").and_then(|v| v.as_array()) {
                state.open_files = open_files
                    .iter()
                    .filter_map(|f| f.as_str().map(|s| s.to_string()))
                    .collect();
            }
            if let Some(active_model) = payload.get("active_model") {
                state.active_model = active_model.as_str().map(|s| s.to_string());
            }
            if let Some(bg_model) = payload.get("background_model") {
                state.background_model = bg_model.as_str().map(|s| s.to_string());
            }
            save_workspace_state(&conn, &state)?;
            Ok(serde_json::json!({ "saved": true }))
        }
        _ => Err(format!("Unknown workspace action: {}", action)),
    }
}
