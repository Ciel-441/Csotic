use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub fn on_file_changed(
    project_path: &str,
    file_path: &str,
    new_content: &str,
    db: &Mutex<Connection>,
) {
    let project_id = crate::services::filesystem::compute_project_id(project_path);
    let full_path = Path::new(project_path).join(file_path);
    let symbols = crate::services::symbols::extract_symbols(&full_path, new_content);
    let hash = crate::services::filesystem::compute_sha256(new_content);
    let size = new_content.len() as i64;
    let now = chrono::Utc::now().to_rfc3339();
    let mtime = std::fs::metadata(&full_path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let ext = full_path.extension().and_then(|e| e.to_str()).unwrap_or("");

    if let Ok(conn) = db.lock() {
        // 1. Update authoritative file_state in SQLite
        let _ = conn.execute(
            "INSERT OR REPLACE INTO file_state (
                project_id, relative_path, content_hash, size, mtime, language, indexed_at, deleted
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
            rusqlite::params![project_id, file_path, hash, size, mtime, ext, now],
        );

        // 2. Synchronize symbols table for this file
        let _ = conn.execute(
            "DELETE FROM symbols WHERE project_id = ?1 AND file_path = ?2",
            rusqlite::params![project_id, file_path],
        );
        for sym in &symbols {
            let sym_id = format!("{}:{}:{}", project_id, file_path, sym.name);
            let _ = conn.execute(
                "INSERT OR REPLACE INTO symbols (
                    id, project_id, file_path, name, kind, start_line, end_line
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![
                    sym_id,
                    project_id,
                    file_path,
                    sym.name,
                    sym.kind,
                    sym.start_line as i64,
                    sym.end_line as i64
                ],
            );
        }

        // 3. Update knowledge graph nodes
        let prefix = format!("symbol://{}/%", file_path);
        let _ = conn.execute(
            "DELETE FROM graph_nodes WHERE project_id = ?1 AND id LIKE ?2",
            rusqlite::params![project_id, prefix],
        );

        for sym in symbols {
            let node_id = format!("symbol://{}/{}", file_path, sym.name);
            let properties = format!(
                "{{\"line\": {}, \"kind\": \"{}\"}}",
                sym.start_line, sym.kind
            );
            let _ = conn.execute(
                "INSERT OR REPLACE INTO graph_nodes (id, project_id, kind, properties) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![node_id, project_id, sym.kind, properties],
            );
        }
    }
}

pub fn on_file_deleted(project_path: &str, file_path: &str, db: &Mutex<Connection>) {
    let project_id = crate::services::filesystem::compute_project_id(project_path);
    if let Ok(conn) = db.lock() {
        let _ = conn.execute(
            "UPDATE file_state SET deleted = 1 WHERE project_id = ?1 AND relative_path = ?2",
            rusqlite::params![project_id, file_path],
        );
        let _ = conn.execute(
            "DELETE FROM symbols WHERE project_id = ?1 AND file_path = ?2",
            rusqlite::params![project_id, file_path],
        );
        let prefix = format!("symbol://{}/%", file_path);
        let _ = conn.execute(
            "DELETE FROM graph_nodes WHERE project_id = ?1 AND id LIKE ?2",
            rusqlite::params![project_id, prefix],
        );
    }
}
