use ignore::WalkBuilder;
use rusqlite::Connection;
use std::fs;
use std::sync::Mutex;

pub fn handle(
    action: &str,
    payload: &serde_json::Value,
    db: &Mutex<Connection>,
) -> Result<serde_json::Value, String> {
    match action {
        "start" => {
            let project_path = payload
                .get("project_path")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'project_path'")?;
            let project_id = payload
                .get("project_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| crate::services::filesystem::compute_project_id(project_path));

            let mut file_count = 0;
            let mut total_lines = 0;
            let mut file_tree = Vec::new();

            let walker = WalkBuilder::new(project_path)
                .hidden(false)
                .git_ignore(true)
                .build();

            let now = chrono::Utc::now().to_rfc3339();
            let conn = db.lock().map_err(|e| format!("DB lock error: {e}"))?;

            for entry in walker.flatten() {
                let path = entry.path();
                if path.is_file() {
                    let path_str = path.to_string_lossy();
                    if path_str.contains("node_modules")
                        || path_str.contains(".git")
                        || path_str.contains("target")
                        || path_str.contains("dist")
                    {
                        continue;
                    }

                    file_count += 1;
                    let rel_path = path
                        .strip_prefix(project_path)
                        .unwrap_or(path)
                        .to_string_lossy()
                        .replace('\\', "/");

                    if let Ok(content) = fs::read_to_string(path) {
                        let lines = content.lines().count();
                        total_lines += lines;
                        file_tree.push(format!("{}: {} lines", rel_path, lines));

                        let hash = crate::services::filesystem::compute_sha256(&content);
                        let size = content.len() as i64;
                        let mtime = fs::metadata(path)
                            .and_then(|m| m.modified())
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);
                        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

                        // Insert into file_state
                        let _ = conn.execute(
                            "INSERT OR REPLACE INTO file_state (
                                project_id, relative_path, content_hash, size, mtime, language, indexed_at, deleted
                            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
                            rusqlite::params![project_id, rel_path, hash, size, mtime, ext, now],
                        );

                        // Extract and persist symbols
                        let symbols = crate::services::symbols::extract_symbols(path, &content);
                        for sym in symbols {
                            let sym_id = format!("{}:{}:{}", project_id, rel_path, sym.name);
                            let _ = conn.execute(
                                "INSERT OR REPLACE INTO symbols (
                                    id, project_id, file_path, name, kind, start_line, end_line
                                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                                rusqlite::params![
                                    sym_id,
                                    project_id,
                                    rel_path,
                                    sym.name,
                                    sym.kind,
                                    sym.start_line as i64,
                                    sym.end_line as i64
                                ],
                            );
                        }
                    }
                }
            }

            let summary = format!(
                "Project contains {} files, total {} lines.\n\nFile tree structure:\n{}",
                file_count,
                total_lines,
                file_tree.join("\n")
            );

            // Insert summary under both canonical project_id and project_path for robust multi-path lookup
            let _ = conn.execute(
                "INSERT OR REPLACE INTO project_index (project_path, summary, file_count, indexed_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![project_id, summary, file_count, now],
            );
            conn.execute(
                "INSERT OR REPLACE INTO project_index (project_path, summary, file_count, indexed_at) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![project_path, summary, file_count, now],
            ).map_err(|e| format!("DB insert error: {e}"))?;

            Ok(serde_json::json!({ "indexed_files": file_count, "project_id": project_id }))
        }
        "get_summary" => {
            let identifier = payload
                .get("project_id")
                .or_else(|| payload.get("project_path"))
                .and_then(|v| v.as_str())
                .ok_or("Missing 'project_id' or 'project_path'")?;
            let computed_id = crate::services::filesystem::compute_project_id(identifier);

            let conn = db.lock().map_err(|e| format!("DB lock error: {e}"))?;
            let mut stmt = conn.prepare("SELECT summary FROM project_index WHERE project_path = ?1 OR project_path = ?2")
                .map_err(|e| format!("DB prepare error: {e}"))?;
            let summary: Option<String> = stmt
                .query_row([identifier, &computed_id], |row| row.get(0))
                .ok();

            Ok(serde_json::json!({
                "summary": summary.unwrap_or_else(|| "Project not yet indexed.".to_string())
            }))
        }
        "search" => {
            let query = payload
                .get("query")
                .and_then(|v| v.as_str())
                .ok_or("Missing 'query'")?;
            let project_path = payload.get("project_path").and_then(|v| v.as_str());

            let mut results: Vec<serde_json::Value> = Vec::new();
            if query.trim().is_empty() {
                return Ok(serde_json::json!({ "results": results }));
            }

            let search_root = project_path.unwrap_or(".");
            let query_lower = query.to_lowercase();

            let walker = WalkBuilder::new(search_root)
                .hidden(false)
                .git_ignore(true)
                .build();

            for result in walker {
                if results.len() >= 100 {
                    break;
                }
                if let Ok(entry) = result {
                    if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                        let path = entry.path();
                        let path_str = path.to_string_lossy().to_string();
                        if path_str.contains("node_modules")
                            || path_str.contains(".git")
                            || path_str.contains("target")
                            || path_str.contains("dist")
                            || path_str.contains("build")
                        {
                            continue;
                        }

                        let file_name = path
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("")
                            .to_string();
                        let mut file_matched_name = false;

                        // Check if file name matches query
                        if file_name.to_lowercase().contains(&query_lower) {
                            file_matched_name = true;
                            results.push(serde_json::json!({
                                "path": path_str,
                                "file_name": file_name,
                                "line_number": 0,
                                "line_text": "[Filename Match]"
                            }));
                        }

                        // Also scan file contents for matching lines
                        if let Ok(content) = fs::read_to_string(path) {
                            for (line_idx, line) in content.lines().enumerate() {
                                if line.to_lowercase().contains(&query_lower) {
                                    let trimmed_line = line.trim();
                                    if !file_matched_name || line_idx > 0 {
                                        results.push(serde_json::json!({
                                            "path": path_str,
                                            "file_name": file_name,
                                            "line_number": line_idx + 1,
                                            "line_text": if trimmed_line.len() > 100 { format!("{}...", &trimmed_line[..100]) } else { trimmed_line.to_string() }
                                        }));
                                    }
                                    if results.len() >= 100 {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Ok(serde_json::json!({ "results": results }))
        }
        _ => Err(format!("Unknown indexing action: {action}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_indexing_uses_canonical_project_id() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(temp_dir.join("src")).unwrap();
        let proj_path = temp_dir.to_str().unwrap();

        std::fs::write(
            temp_dir.join("src").join("main.rs"),
            "pub fn calculate_total(a: i32, b: i32) -> i32 { a + b }",
        )
        .unwrap();

        let db_dir = std::env::temp_dir().join(format!("forge_db_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&db_dir).unwrap();
        let db = Mutex::new(crate::db::init_db(&db_dir.join("test.db")).unwrap());

        // 1. Run indexing without explicit project_id in payload
        let payload = serde_json::json!({
            "project_path": proj_path,
        });
        let res = handle("start", &payload, &db);
        assert!(res.is_ok());

        let expected_project_id = crate::services::filesystem::compute_project_id(proj_path);
        let res_json = res.unwrap();
        assert_eq!(
            res_json.get("project_id").unwrap().as_str().unwrap(),
            expected_project_id
        );

        // 2. Query file_state using expected_project_id
        let conn = db.lock().unwrap();
        let state_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM file_state WHERE project_id = ?1",
                rusqlite::params![expected_project_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(state_count, 1);

        // 3. Query symbols using expected_project_id
        let symbol_name: String = conn
            .query_row(
                "SELECT name FROM symbols WHERE project_id = ?1",
                rusqlite::params![expected_project_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(symbol_name, "calculate_total");

        // 4. Query summary by project_path
        drop(conn);
        let summary_res = handle(
            "get_summary",
            &serde_json::json!({ "project_path": proj_path }),
            &db,
        );
        assert!(summary_res.is_ok());
        let summary_str = summary_res
            .unwrap()
            .get("summary")
            .unwrap()
            .as_str()
            .unwrap()
            .to_string();
        assert!(summary_str.contains("Project contains 1 files"));

        let _ = std::fs::remove_dir_all(&temp_dir);
        let _ = std::fs::remove_dir_all(&db_dir);
    }
}
