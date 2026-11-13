use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use rusqlite::Connection;
use ignore::WalkBuilder;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceTruth {
    pub project_id: String,
    pub root: String,
    pub filesystem_generation: u64,
    pub last_scan: String,
    pub file_hashes: HashMap<String, String>,
    pub deleted_files: HashSet<String>,
    pub changed_files: HashSet<String>,
    pub active_task: Option<String>,
}

static CURRENT_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

impl WorkspaceTruth {
    /// Refreshes the workspace truth from disk, synchronizing with SQLite file_state.
    pub fn refresh_truth(project_path: &str, db: &Mutex<Connection>) -> Result<Self, String> {
        let clean_path = if let Some(rest) = project_path.strip_prefix(r"\\?\") {
            rest
        } else if let Some(rest) = project_path.strip_prefix("//?/") {
            rest
        } else {
            project_path
        };

        let project_id = crate::services::filesystem::compute_project_id(clean_path);
        let now = chrono::Utc::now().to_rfc3339();
        let gen = CURRENT_GENERATION.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        let mut file_hashes = HashMap::new();
        let mut seen_rel_paths = HashSet::new();
        let mut changed_files = HashSet::new();

        let walker = WalkBuilder::new(clean_path)
            .hidden(false)
            .git_ignore(true)
            .build();

        let conn = db.lock().map_err(|e| format!("DB lock error: {e}"))?;

        // Load existing file state from DB
        let mut existing_db_hashes: HashMap<String, String> = HashMap::new();
        if let Ok(mut stmt) = conn.prepare("SELECT relative_path, content_hash FROM file_state WHERE project_id = ?1 AND deleted = 0") {
            if let Ok(rows) = stmt.query_map(rusqlite::params![project_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            }) {
                for item in rows.flatten() {
                    existing_db_hashes.insert(item.0, item.1);
                }
            }
        }

        for result in walker.flatten() {
            let path = result.path();
            if path.is_file() {
                let path_str = path.to_string_lossy();
                if path_str.contains("node_modules") || path_str.contains(".git") 
                    || path_str.contains("target") || path_str.contains("dist") {
                    continue;
                }

                let rel_path = path.strip_prefix(clean_path)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .replace('\\', "/");

                seen_rel_paths.insert(rel_path.clone());

                if let Ok(content) = fs::read_to_string(path) {
                    let hash = crate::services::filesystem::compute_sha256(&content);
                    file_hashes.insert(rel_path.clone(), hash.clone());

                    let is_changed = match existing_db_hashes.get(&rel_path) {
                        Some(old_hash) => old_hash != &hash,
                        None => true,
                    };

                    if is_changed {
                        changed_files.insert(rel_path.clone());
                        let size = content.len() as i64;
                        let mtime = fs::metadata(path)
                            .and_then(|m| m.modified())
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_secs() as i64)
                            .unwrap_or(0);
                        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

                        let _ = conn.execute(
                            "INSERT OR REPLACE INTO file_state (
                                project_id, relative_path, content_hash, size, mtime, language, indexed_at, deleted
                            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
                            rusqlite::params![project_id, rel_path, hash, size, mtime, ext, now],
                        );

                        // Synchronize symbols for modified/new file
                        let symbols = crate::services::symbols::extract_symbols(path, &content);
                        for sym in symbols {
                            let sym_id = format!("{}:{}:{}", project_id, rel_path, sym.name);
                            let _ = conn.execute(
                                "INSERT OR REPLACE INTO symbols (
                                    id, project_id, file_path, name, kind, start_line, end_line
                                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                                rusqlite::params![sym_id, project_id, rel_path, sym.name, sym.kind, sym.start_line as i64, sym.end_line as i64],
                            );
                        }
                    }
                }
            }
        }

        // Detect deleted files
        let mut deleted_files = HashSet::new();
        for old_rel in existing_db_hashes.keys() {
            if !seen_rel_paths.contains(old_rel) {
                deleted_files.insert(old_rel.clone());
                let _ = conn.execute(
                    "UPDATE file_state SET deleted = 1 WHERE project_id = ?1 AND relative_path = ?2",
                    rusqlite::params![project_id, old_rel],
                );
                let _ = conn.execute(
                    "DELETE FROM symbols WHERE project_id = ?1 AND file_path = ?2",
                    rusqlite::params![project_id, old_rel],
                );
            }
        }

        // Detect active AI task
        let active_task: Option<String> = conn.query_row(
            "SELECT id FROM ai_tasks WHERE project_id = ?1 AND status = 'running' ORDER BY created_at DESC LIMIT 1",
            rusqlite::params![project_id],
            |r| r.get(0),
        ).ok();

        Ok(Self {
            project_id,
            root: clean_path.to_string(),
            filesystem_generation: gen,
            last_scan: now,
            file_hashes,
            deleted_files,
            changed_files,
            active_task,
        })
    }

    /// Fast O(1) targeted pre-mutation check against physical disk state without walking the whole workspace tree.
    pub fn verify_target_fast(
        project_path: &str,
        rel_path: &str,
        expected_hash: Option<&str>,
        is_create: bool,
    ) -> Result<(), String> {
        let clean_path = if let Some(rest) = project_path.strip_prefix(r"\\?\") {
            rest
        } else if let Some(rest) = project_path.strip_prefix("//?/") {
            rest
        } else {
            project_path
        };
        let clean_rel = rel_path.replace('\\', "/").trim_start_matches('/').to_string();
        let full_path = Path::new(clean_path).join(&clean_rel);

        if is_create {
            if full_path.exists() {
                return Err(format!(
                    "TRUTH_VIOLATION: create_file aborted because '{}' already exists on disk. Use modify_file or patch_file instead.",
                    clean_rel
                ));
            }
        } else {
            if !full_path.exists() {
                return Err(format!(
                    "TRUTH_VIOLATION: Mutation aborted because target file '{}' does not exist on disk.",
                    clean_rel
                ));
            }
            if let Some(exp) = expected_hash {
                if !exp.is_empty() {
                    match fs::read_to_string(&full_path) {
                        Ok(current_content) => {
                            let current_hash = crate::services::filesystem::compute_sha256(&current_content);
                            if current_hash != exp {
                                return Err(format!(
                                    "TRUTH_VIOLATION: Conflict detected on '{}'. Expected hash '{}' but disk currently has '{}'. The file was modified externally.",
                                    clean_rel, exp, current_hash
                                ));
                            }
                        }
                        Err(e) => return Err(format!("Failed to read target file '{}' for hash verification: {e}", clean_rel)),
                    }
                }
            }
        }
        Ok(())
    }

    /// Verifies that a planned mutation matches the current reality of the disk.
    #[allow(dead_code)]
    pub fn verify_pre_mutation(
        &self,
        rel_path: &str,
        expected_hash: Option<&str>,
        is_create: bool,
    ) -> Result<(), String> {
        Self::verify_target_fast(&self.root, rel_path, expected_hash, is_create)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_truth_pre_mutation_checks() {
        let temp_dir = std::env::temp_dir().join(format!("forge_truth_test_{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_dir);

        let test_file = temp_dir.join("existing.txt");
        let _ = fs::write(&test_file, "initial content");
        let initial_hash = crate::services::filesystem::compute_sha256("initial content");

        let truth = WorkspaceTruth {
            project_id: "test-proj".to_string(),
            root: temp_dir.to_string_lossy().to_string(),
            filesystem_generation: 1,
            last_scan: "now".to_string(),
            file_hashes: HashMap::new(),
            deleted_files: HashSet::new(),
            changed_files: HashSet::new(),
            active_task: None,
        };

        // Pre-mutation: create_file on existing file should fail
        assert!(truth.verify_pre_mutation("existing.txt", None, true).is_err());

        // Pre-mutation: create_file on non-existing file should succeed
        assert!(truth.verify_pre_mutation("new_file.txt", None, true).is_ok());

        // Pre-mutation: modify_file with matching expected hash should succeed
        assert!(truth.verify_pre_mutation("existing.txt", Some(&initial_hash), false).is_ok());

        // Pre-mutation: modify_file with stale hash should fail
        assert!(truth.verify_pre_mutation("existing.txt", Some("stale_hash_xyz"), false).is_err());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
