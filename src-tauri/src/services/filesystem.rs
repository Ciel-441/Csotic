use std::path::{Path, PathBuf};
use std::fs;
use std::sync::{Mutex, OnceLock};
use std::num::NonZeroUsize;
use lru::LruCache;

fn file_cache() -> &'static Mutex<LruCache<String, String>> {
    static CACHE: OnceLock<Mutex<LruCache<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(LruCache::new(NonZeroUsize::new(100).unwrap())))
}

const MAX_FILE_SIZE: u64 = 2 * 1024 * 1024; // 2MB

fn strip_unc_prefix(path_str: &str) -> String {
    let s = path_str.trim();
    let stripped = if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest
    } else if let Some(rest) = s.strip_prefix("//?/") {
        rest
    } else if let Some(rest) = s.strip_prefix(r"\??\") {
        rest
    } else {
        s
    };
    #[cfg(target_os = "windows")]
    {
        stripped.replace('/', "\\")
    }
    #[cfg(not(target_os = "windows"))]
    {
        stripped.to_string()
    }
}

/// Resolve an absolute path that the user has explicitly picked via a file/folder
/// dialog or typed directly, without requiring it to be inside a project.
fn absolute_resolve(raw_path: &str) -> Result<PathBuf, String> {
    let clean = strip_unc_prefix(raw_path);
    let p = PathBuf::from(&clean);
    if !p.is_absolute() {
        return Err(format!("Path is not absolute: {raw_path}"));
    }
    Ok(p)
}

/// Resolve a path while proving it remains inside the active project.
///
/// Absolute paths are accepted for Explorer/editor interoperability, but only
/// after their canonical location is checked against the project root. This is
/// important because Tauri IPC is not a security boundary by itself.
pub fn safe_resolve(project_path: &str, raw_path: &str) -> Result<PathBuf, String> {
    let clean_proj = strip_unc_prefix(project_path);
    let clean_raw = strip_unc_prefix(raw_path);

    if clean_proj.trim().is_empty() {
        // When no project is open, allow absolute paths directly
        // (user explicitly picked the file via OS dialog or typed the path)
        return absolute_resolve(&clean_raw);
    }

    let base_canon = PathBuf::from(&clean_proj).canonicalize()
        .map_err(|e| format!("Invalid project path: {e}"))?;
    if !base_canon.is_dir() {
        return Err("Active project path is not a directory".to_string());
    }

    let clean_base = PathBuf::from(strip_unc_prefix(&base_canon.to_string_lossy()));

    let raw = Path::new(&clean_raw);
    let joined = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        clean_base.join(raw)
    };

    // Normalize path by eliminating '.' and '..' components programmatically
    let mut normalized = PathBuf::new();
    for comp in joined.components() {
        match comp {
            std::path::Component::Prefix(p) => normalized.push(p.as_os_str()),
            std::path::Component::RootDir => normalized.push(comp.as_os_str()),
            std::path::Component::CurDir => {},
            std::path::Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!("Path traversal blocked: {} escapes project root", raw_path));
                }
            }
            std::path::Component::Normal(c) => normalized.push(c),
        }
    }

    // Now canonicalize normalized path if it exists, or canonicalize its parent if it doesn't
    let canonical = if normalized.exists() {
        normalized.canonicalize().map_err(|e| format!("Path error: {e}"))?
    } else {
        let parent = normalized.parent().ok_or_else(|| "Invalid filesystem path".to_string())?;
        if parent.exists() {
            let parent_canon = parent.canonicalize().map_err(|e| format!("Path error: {e}"))?;
            let file_name = normalized.file_name().ok_or_else(|| "Invalid file name".to_string())?;
            parent_canon.join(file_name)
        } else {
            normalized.clone()
        }
    };

    let clean_target = PathBuf::from(strip_unc_prefix(&canonical.to_string_lossy()));

    if !clean_target.starts_with(&clean_base) {
        return Err(format!("Path traversal blocked: {} escapes project root", raw_path));
    }

    Ok(clean_target)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub enum MutationActor {
    /// Direct manual user action (e.g. Monaco Editor, file tree)
    User,
    /// Autonomous Agent executing a planned task ChangeSet
    Agent { task_id: String },
}

pub async fn handle(action: &str, payload: &serde_json::Value, _project_path: Option<&str>, permission_profile: Option<&str>) -> Result<serde_json::Value, String> {
    let pp = _project_path.unwrap_or("");
    let profile = permission_profile.unwrap_or("developer");

    let is_mutation = matches!(action, "write_file" | "create_dir" | "patch_file" | "delete" | "rename" | "copy_file");
    if is_mutation && profile == "read_only" {
        return Err(format!("Permission denied: active profile is 'read_only', action '{action}' is blocked."));
    }

    let actor = if let Some(task_id) = payload.get("agent_task_id").and_then(|v| v.as_str()) {
        MutationActor::Agent { task_id: task_id.to_string() }
    } else {
        MutationActor::User
    };

    // Safety boundary: AI Agent tasks must NEVER bypass ChangeSetEngine to call generic write_file
    if let MutationActor::Agent { task_id } = &actor {
        if action == "write_file" {
            return Err(format!(
                "ARCHITECTURAL_VIOLATION: AI Agent (task '{task_id}') cannot use generic write_file. All agent mutations must pass through ChangeSetEngine."
            ));
        }
    }

    match action {
        "read_dir" => {
            let path = payload.get("path").and_then(|v| v.as_str())
                .ok_or("Missing 'path'")?;
            let resolved = safe_resolve(pp, path)?;
            let mut entries = Vec::new();
            let read = fs::read_dir(&resolved).map_err(|e| format!("Cannot read dir: {e}"))?;
            for entry in read.flatten() {
                let meta = entry.metadata().ok();
                let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
                let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                let clean_entry_path = strip_unc_prefix(&entry.path().to_string_lossy());
                entries.push(serde_json::json!({
                    "name": entry.file_name().to_string_lossy(),
                    "path": clean_entry_path,
                    "is_dir": is_dir,
                    "size": size,
                }));
            }
            // Sort: dirs first, then alpha
            entries.sort_by(|a, b| {
                let a_dir = a.get("is_dir").and_then(|v| v.as_bool()).unwrap_or(false);
                let b_dir = b.get("is_dir").and_then(|v| v.as_bool()).unwrap_or(false);
                b_dir.cmp(&a_dir).then_with(|| {
                    let a_name = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let b_name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    a_name.to_lowercase().cmp(&b_name.to_lowercase())
                })
            });
            Ok(serde_json::json!({ "entries": entries }))
        }
        "read_file" => {
            let path = payload.get("path").and_then(|v| v.as_str())
                .ok_or("Missing 'path'")?;
            let resolved = safe_resolve(pp, path)?;
            if !resolved.exists() {
                return Err(format!("File not found: {}", resolved.display()));
            }
            let meta = fs::metadata(&resolved).map_err(|e| format!("File not found: {e}"))?;
            if meta.len() > MAX_FILE_SIZE {
                return Err(format!("File too large ({} bytes, max {})", meta.len(), MAX_FILE_SIZE));
            }
            let content = fs::read_to_string(&resolved)
                .map_err(|_| "File is not valid UTF-8 (binary file?)".to_string())?;
            Ok(serde_json::json!({ "content": content }))
        }
        "write_file" => {
            let path = payload.get("path").and_then(|v| v.as_str())
                .ok_or("Missing 'path'")?;
            let content = payload.get("content").and_then(|v| v.as_str())
                .ok_or("Missing 'content'")?;
            let resolved = safe_resolve(pp, path)?;
            if let Some(parent) = resolved.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent).map_err(|e| format!("Cannot create dirs: {e}"))?;
                }
            }
            let bytes = content.len();
            fs::write(&resolved, content).map_err(|e| format!("Write failed: {e}"))?;
            let key = resolved.to_string_lossy().to_string();
            let mut cache = file_cache().lock().unwrap();
            cache.put(key, content.to_string());
            let hash = compute_sha256(content);
            Ok(serde_json::json!({ "written": true, "bytes": bytes, "hash": hash, "path": resolved.to_string_lossy() }))
        }
        "create_dir" => {
            let path = payload.get("path").and_then(|v| v.as_str())
                .ok_or("Missing 'path'")?;
            create_dir_strict(pp, path)?;
            Ok(serde_json::json!({ "created": true }))
        }
        "rename" => {
            let old_path = payload.get("old_path").and_then(|v| v.as_str())
                .ok_or("Missing 'old_path'")?;
            let new_path = payload.get("new_path").and_then(|v| v.as_str())
                .ok_or("Missing 'new_path'")?;
            move_file_strict(pp, old_path, new_path)?;
            Ok(serde_json::json!({ "renamed": true, "old_path": old_path, "new_path": new_path }))
        }
        "copy_file" => {
            let src_path = payload.get("src_path").and_then(|v| v.as_str())
                .ok_or("Missing 'src_path'")?;
            let dest_path = payload.get("dest_path").and_then(|v| v.as_str())
                .ok_or("Missing 'dest_path'")?;
            copy_file_strict(pp, src_path, dest_path)?;
            Ok(serde_json::json!({ "copied": true }))
        }
        "get_file_tree" => {
            let clean_pp = strip_unc_prefix(pp);
            if clean_pp.trim().is_empty() {
                return Ok(serde_json::json!({ "files": [] }));
            }
            let base_path = PathBuf::from(&clean_pp).canonicalize().map_err(|e| format!("Invalid path: {e}"))?;
            let clean_base_path = PathBuf::from(strip_unc_prefix(&base_path.to_string_lossy()));
            let mut files = Vec::new();
            let walker = ignore::WalkBuilder::new(&clean_base_path)
                .hidden(false)
                .git_ignore(true)
                .git_global(true)
                .git_exclude(true)
                .max_depth(Some(12))
                .build();

            for result in walker {
                if let Ok(entry) = result {
                    let entry_raw = entry.path();
                    let clean_entry = PathBuf::from(strip_unc_prefix(&entry_raw.to_string_lossy()));
                    if clean_entry == clean_base_path {
                        continue;
                    }
                    let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);
                    let rel_path = clean_entry.strip_prefix(&clean_base_path)
                        .map(|p| p.to_string_lossy().replace('\\', "/"))
                        .unwrap_or_else(|_| clean_entry.to_string_lossy().to_string());
                    
                    // Skip noisy dependency and build directories
                    if rel_path.starts_with(".git/") || rel_path == ".git"
                        || rel_path.starts_with("node_modules/") || rel_path == "node_modules"
                        || rel_path.starts_with("target/") || rel_path == "target"
                        || rel_path.starts_with(".next/") || rel_path == ".next"
                        || rel_path.starts_with("dist/") || rel_path == "dist" {
                        continue;
                    }

                    files.push(serde_json::json!({
                        "name": entry.file_name().to_string_lossy(),
                        "path": clean_entry.to_string_lossy(),
                        "relative_path": rel_path,
                        "is_dir": is_dir,
                    }));
                }
            }
            Ok(serde_json::json!({ "files": files }))
        }
        "search_in_files" => {
            let clean_pp = strip_unc_prefix(pp);
            if clean_pp.trim().is_empty() {
                return Ok(serde_json::json!({ "matches": [] }));
            }
            let query = payload.get("query").and_then(|v| v.as_str()).unwrap_or("");
            if query.trim().is_empty() {
                return Ok(serde_json::json!({ "matches": [] }));
            }
            let case_sensitive = payload.get("case_sensitive").and_then(|v| v.as_bool()).unwrap_or(false);
            let base_path = PathBuf::from(&clean_pp).canonicalize().map_err(|e| format!("Invalid path: {e}"))?;
            let clean_base = PathBuf::from(strip_unc_prefix(&base_path.to_string_lossy()));
            let mut matches = Vec::new();
            let walker = ignore::WalkBuilder::new(&clean_base)
                .hidden(false)
                .git_ignore(true)
                .build();

            let query_lower = query.to_lowercase();
            let mut total_matches = 0;

            for result in walker {
                if total_matches >= 300 {
                    break;
                }
                if let Ok(entry) = result {
                    if entry.file_type().map(|ft| ft.is_file()).unwrap_or(false) {
                        let path = entry.path();
                        if let Ok(meta) = fs::metadata(path) {
                            if meta.len() > MAX_FILE_SIZE {
                                continue;
                            }
                        }
                        if let Ok(content) = fs::read_to_string(path) {
                            let rel_path = path.strip_prefix(&base_path)
                                .map(|p| p.to_string_lossy().replace('\\', "/"))
                                .unwrap_or_else(|_| path.to_string_lossy().to_string());

                            for (line_idx, line) in content.lines().enumerate() {
                                let is_match = if case_sensitive {
                                    line.contains(query)
                                } else {
                                    line.to_lowercase().contains(&query_lower)
                                };
                                if is_match {
                                    matches.push(serde_json::json!({
                                        "file": path.to_string_lossy(),
                                        "relative_path": rel_path,
                                        "line_number": line_idx + 1,
                                        "line_text": line.trim(),
                                    }));
                                    total_matches += 1;
                                    if total_matches >= 300 {
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Ok(serde_json::json!({ "matches": matches, "total": total_matches }))
        }
        "patch_file" => {
            let path = payload.get("path").and_then(|v| v.as_str())
                .ok_or("Missing 'path'")?;
            let target = payload.get("target").and_then(|v| v.as_str())
                .ok_or("Missing 'target'")?;
            let replacement = payload.get("replacement").and_then(|v| v.as_str())
                .ok_or("Missing 'replacement'")?;
            let expected_hash = payload.get("expected_hash").and_then(|v| v.as_str()).unwrap_or("");
            let (_old, _new, hash) = patch_file_strict(pp, path, expected_hash, target, replacement)?;
            Ok(serde_json::json!({ "patched": true, "hash": hash }))
        }
        "delete" => {
            let path = payload.get("path").and_then(|v| v.as_str())
                .ok_or("Missing 'path'")?;
            let approved = payload.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
            delete_file_strict(pp, path, approved)?;
            Ok(serde_json::json!({ "deleted": true }))
        }
        "select_folder" => {
            let path_opt = tokio::task::spawn_blocking(|| {
                rfd::FileDialog::new().pick_folder()
            }).await.map_err(|e| format!("Dialog thread error: {e}"))?;

            if let Some(folder) = path_opt {
                let clean = strip_unc_prefix(&folder.to_string_lossy());
                Ok(serde_json::json!({ "path": clean }))
            } else {
                Ok(serde_json::json!({ "path": serde_json::Value::Null }))
            }
        }
        "select_files" => {
            let files_opt = tokio::task::spawn_blocking(|| {
                rfd::FileDialog::new().pick_files()
            }).await.map_err(|e| format!("Dialog thread error: {e}"))?;

            if let Some(files) = files_opt {
                let paths: Vec<String> = files.iter().map(|f| strip_unc_prefix(&f.to_string_lossy())).collect();
                Ok(serde_json::json!({ "paths": paths }))
            } else {
                Ok(serde_json::json!({ "paths": Vec::<String>::new() }))
            }
        }
        "save_as_dialog" => {
            let default_name = payload.get("default_name").and_then(|v| v.as_str()).unwrap_or("untitled.txt").to_string();
            let content = payload.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let path_opt = tokio::task::spawn_blocking(move || {
                rfd::FileDialog::new()
                    .set_file_name(&default_name)
                    .save_file()
            }).await.map_err(|e| format!("Dialog thread error: {e}"))?;

            if let Some(path) = path_opt {
                fs::write(&path, &content).map_err(|e| format!("Save failed: {e}"))?;
                let clean = strip_unc_prefix(&path.to_string_lossy());
                Ok(serde_json::json!({ "path": clean, "saved": true }))
            } else {
                Ok(serde_json::json!({ "path": serde_json::Value::Null, "saved": false }))
            }
        }
        "open_file_dialog" => {
            let path_opt = tokio::task::spawn_blocking(|| {
                rfd::FileDialog::new().pick_file()
            }).await.map_err(|e| format!("Dialog thread error: {e}"))?;

            if let Some(path) = path_opt {
                let meta = fs::metadata(&path).map_err(|e| format!("File error: {e}"))?;
                if meta.len() > MAX_FILE_SIZE {
                    return Err(format!("File too large ({} bytes, max {})", meta.len(), MAX_FILE_SIZE));
                }
                let content = fs::read_to_string(&path)
                    .map_err(|_| "File is not valid UTF-8 (binary file?)".to_string())?;
                let clean = strip_unc_prefix(&path.to_string_lossy());
                let file_name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                Ok(serde_json::json!({
                    "path": clean,
                    "content": content,
                    "name": file_name
                }))
            } else {
                Ok(serde_json::json!({ "path": serde_json::Value::Null }))
            }
        }
        _ => Err(format!("Unknown filesystem action: {action}")),
    }
}

pub fn compute_sha256(content: &str) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Compute a canonical SHA-256 project ID from a project root path.
/// Guarantees consistent identity across workspace, indexing, agent, memories, and symbols.
pub fn compute_project_id(project_path: &str) -> String {
    let clean = strip_unc_prefix(project_path);
    let canonical = std::fs::canonicalize(&clean)
        .map(|p| strip_unc_prefix(&p.to_string_lossy()).to_string())
        .unwrap_or_else(|_| clean.to_string());
    compute_sha256(&canonical)
}

// Re-export for agent tool usage
pub fn read_file_str(project_path: &str, path: &str) -> Result<String, String> {
    let resolved = safe_resolve(project_path, path)?;
    let key = resolved.to_string_lossy().to_string();

    {
        let mut cache = file_cache().lock().unwrap();
        if let Some(content) = cache.get(&key) {
            return Ok(content.clone());
        }
    }

    let meta = fs::metadata(&resolved).map_err(|e| format!("File not found: {e}"))?;
    if meta.len() > MAX_FILE_SIZE {
        return Err(format!("File too large ({} bytes)", meta.len()));
    }
    
    let content = fs::read_to_string(&resolved).map_err(|_| "File is not valid UTF-8".to_string())?;
    
    let mut cache = file_cache().lock().unwrap();
    cache.put(key, content.clone());
    Ok(content)
}

pub fn read_file_with_hash(project_path: &str, path: &str) -> Result<(String, String), String> {
    let content = read_file_str(project_path, path)?;
    let hash = compute_sha256(&content);
    Ok((content, hash))
}

/// ⚠️ INTERNAL RECOVERY ONLY: Low-level trusted primitive for RollbackJournal.
///
/// SAFETY & ARCHITECTURAL INVARIANT:
/// This function directly writes file content to disk during compensating rollback operations.
/// It MUST NEVER be used as a general-purpose file write helper or called outside the
/// RollbackJournal recovery pipeline. All standard file creations, modifications, and
/// patches must go through `ChangeSetEngine::execute_operation_transactional` to preserve
/// invariant validation, actor boundary checks, and observability.
pub(crate) fn restore_file_for_rollback(project_path: &str, path: &str, content: &str) -> Result<usize, String> {
    let resolved = safe_resolve(project_path, path)?;
    let key = resolved.to_string_lossy().to_string();

    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create dirs: {e}"))?;
    }
    let bytes = content.len();
    fs::write(&resolved, content).map_err(|e| format!("Write failed: {e}"))?;
    
    let mut cache = file_cache().lock().unwrap();
    cache.put(key, content.to_string());
    
    Ok(bytes)
}

/// Strict CREATE ONLY operation: fails if file already exists.
pub fn create_file_strict(project_path: &str, path: &str, content: &str) -> Result<String, String> {
    let resolved = safe_resolve(project_path, path)?;
    if resolved.exists() {
        return Err(format!(
            "FILE_ALREADY_EXISTS: '{}' already exists. Use modify_file or patch_file to edit existing files.",
            path
        ));
    }

    if let Some(parent) = resolved.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create parent directory: {e}"))?;
    }

    fs::write(&resolved, content).map_err(|e| format!("Failed to create file: {e}"))?;
    let key = resolved.to_string_lossy().to_string();
    let mut cache = file_cache().lock().unwrap();
    cache.put(key, content.to_string());

    let hash = compute_sha256(content);
    Ok(hash)
}

/// Strict MODIFY ONLY operation: requires file to exist and expected_hash to match.
pub fn modify_file_strict(
    project_path: &str,
    path: &str,
    expected_hash: &str,
    new_content: &str,
) -> Result<(String, String), String> {
    let resolved = safe_resolve(project_path, path)?;
    if !resolved.is_file() {
        return Err(format!(
            "FILE_NOT_FOUND: '{}' does not exist. Use create_file to create new files.",
            path
        ));
    }

    let old_content = fs::read_to_string(&resolved).map_err(|e| format!("Cannot read file: {e}"))?;
    let current_hash = compute_sha256(&old_content);

    if !expected_hash.trim().is_empty() && current_hash != expected_hash.trim() {
        return Err(format!(
            "HASH_MISMATCH / CONFLICT: '{}' has changed on disk since it was read. Expected hash: {}, Actual hash: {}. Re-read the file to inspect latest content.",
            path, expected_hash, current_hash
        ));
    }

    fs::write(&resolved, new_content).map_err(|e| format!("Failed to write file: {e}"))?;
    let key = resolved.to_string_lossy().to_string();
    let mut cache = file_cache().lock().unwrap();
    cache.put(key, new_content.to_string());

    let new_hash = compute_sha256(new_content);
    Ok((old_content, new_hash))
}

/// Strict PATCH operation: requires file to exist, expected_hash to match, and target string to be unique.
pub fn patch_file_strict(
    project_path: &str,
    path: &str,
    expected_hash: &str,
    target: &str,
    replacement: &str,
) -> Result<(String, String, String), String> {
    let resolved = safe_resolve(project_path, path)?;
    if !resolved.is_file() {
        return Err(format!("FILE_NOT_FOUND: '{}' does not exist.", path));
    }

    let old_content = fs::read_to_string(&resolved).map_err(|e| format!("Cannot read file: {e}"))?;
    let current_hash = compute_sha256(&old_content);

    if !expected_hash.trim().is_empty() && current_hash != expected_hash.trim() {
        return Err(format!(
            "HASH_MISMATCH / CONFLICT: '{}' has changed on disk since it was read. Expected hash: {}, Actual hash: {}. Re-read the file.",
            path, expected_hash, current_hash
        ));
    }

    let count = old_content.matches(target).count();
    if count == 0 {
        return Err(format!("TARGET_NOT_FOUND: Target text does not appear in '{}'.", path));
    }
    if count > 1 {
        return Err(format!(
            "AMBIGUOUS_PATCH: Target text appears {} times in '{}'. It must appear exactly once for a safe patch.",
            count, path
        ));
    }

    let new_content = old_content.replacen(target, replacement, 1);
    fs::write(&resolved, &new_content).map_err(|e| format!("Failed to write patch: {e}"))?;

    let key = resolved.to_string_lossy().to_string();
    let mut cache = file_cache().lock().unwrap();
    cache.put(key, new_content.clone());

    let new_hash = compute_sha256(&new_content);
    Ok((old_content, new_content, new_hash))
}

/// Strict DELETE operation: requires explicit approved=true confirmation.
pub fn delete_file_strict(project_path: &str, path: &str, approved: bool) -> Result<(), String> {
    if !approved {
        return Err("PERMISSION_DENIED: Deletion requires approved=true confirmation.".to_string());
    }

    let resolved = safe_resolve(project_path, path)?;
    if !resolved.exists() {
        return Err(format!("FILE_NOT_FOUND: '{}' does not exist.", path));
    }

    if resolved.is_dir() {
        fs::remove_dir_all(&resolved).map_err(|e| format!("Delete failed: {e}"))?;
    } else {
        fs::remove_file(&resolved).map_err(|e| format!("Delete failed: {e}"))?;
    }

    let key = resolved.to_string_lossy().to_string();
    let mut cache = file_cache().lock().unwrap();
    cache.pop(&key);

    Ok(())
}

/// Strict MOVE operation: source must exist, destination must not.
pub fn move_file_strict(project_path: &str, source: &str, destination: &str) -> Result<(), String> {
    let resolved_src = safe_resolve(project_path, source)?;
    let resolved_dest = safe_resolve(project_path, destination)?;

    if !resolved_src.exists() {
        return Err(format!("FILE_NOT_FOUND: Source '{}' does not exist.", source));
    }
    if resolved_dest.exists() {
        return Err(format!("FILE_ALREADY_EXISTS: Destination '{}' already exists.", destination));
    }

    if let Some(parent) = resolved_dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create parent directory: {e}"))?;
    }

    fs::rename(&resolved_src, &resolved_dest).map_err(|e| format!("Move failed: {e}"))?;

    let src_key = resolved_src.to_string_lossy().to_string();
    let mut cache = file_cache().lock().unwrap();
    cache.pop(&src_key);

    Ok(())
}

/// Strict COPY operation: source must exist, destination must not.
pub fn copy_file_strict(project_path: &str, source: &str, destination: &str) -> Result<String, String> {
    let resolved_src = safe_resolve(project_path, source)?;
    let resolved_dest = safe_resolve(project_path, destination)?;

    if !resolved_src.is_file() {
        return Err(format!("FILE_NOT_FOUND: Source '{}' does not exist.", source));
    }
    if resolved_dest.exists() {
        return Err(format!("FILE_ALREADY_EXISTS: Destination '{}' already exists.", destination));
    }

    if let Some(parent) = resolved_dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Cannot create parent directory: {e}"))?;
    }

    let src_content = fs::read_to_string(&resolved_src).map_err(|e| format!("Cannot read source file: {e}"))?;
    fs::copy(&resolved_src, &resolved_dest).map_err(|e| format!("Copy failed: {e}"))?;

    let hash = compute_sha256(&src_content);
    let key = resolved_dest.to_string_lossy().to_string();
    let mut cache = file_cache().lock().unwrap();
    cache.put(key, src_content);

    Ok(hash)
}

/// Strict CREATE DIRECTORY operation
pub fn create_dir_strict(project_path: &str, path: &str) -> Result<(), String> {
    let resolved = safe_resolve(project_path, path)?;
    fs::create_dir_all(&resolved).map_err(|e| format!("Cannot create directory: {e}"))
}

/// Strict REPLACE operation: explicit full file replacement with hash verification.
pub fn replace_file_strict(
    project_path: &str,
    path: &str,
    expected_hash: &str,
    new_content: &str,
) -> Result<(String, String), String> {
    modify_file_strict(project_path, path, expected_hash, new_content)
}

pub fn list_dir_str(project_path: &str, path: &str) -> Result<String, String> {
    let resolved = safe_resolve(project_path, path)?;
    let mut result = String::new();
    let read = fs::read_dir(&resolved).map_err(|e| format!("Cannot read dir: {e}"))?;
    for entry in read.flatten() {
        let is_dir = entry.metadata().map(|m| m.is_dir()).unwrap_or(false);
        let indicator = if is_dir { "/" } else { "" };
        result.push_str(&format!("{}{}\n", entry.file_name().to_string_lossy(), indicator));
    }
    Ok(result)
}

pub fn create_dir_str(project_path: &str, path: &str) -> Result<(), String> {
    create_dir_strict(project_path, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sha256_computation() {
        let hash1 = compute_sha256("hello world");
        let hash2 = compute_sha256("hello world");
        let hash3 = compute_sha256("different");
        assert_eq!(hash1, hash2);
        assert_ne!(hash1, hash3);
        assert_eq!(hash1, "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
    }

    #[test]
    fn test_create_and_modify_strict() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();
        let proj_path = temp_dir.to_string_lossy().to_string();

        // 1. Create new file succeeds
        let create_res = create_file_strict(&proj_path, "src/hello.txt", "Initial content");
        assert!(create_res.is_ok());
        let hash = create_res.unwrap();

        // 2. Duplicate create fails with FILE_ALREADY_EXISTS
        let dup_res = create_file_strict(&proj_path, "src/hello.txt", "Overwrite attempt");
        assert!(dup_res.is_err());
        assert!(dup_res.unwrap_err().contains("FILE_ALREADY_EXISTS"));

        // 3. Modify with correct hash succeeds
        let mod_res = modify_file_strict(&proj_path, "src/hello.txt", &hash, "Updated content");
        assert!(mod_res.is_ok());
        let (old_content, new_hash) = mod_res.unwrap();
        assert_eq!(old_content, "Initial content");

        // 4. Modify with stale hash fails with HASH_MISMATCH
        let stale_res = modify_file_strict(&proj_path, "src/hello.txt", &hash, "Stale edit");
        assert!(stale_res.is_err());
        assert!(stale_res.unwrap_err().contains("HASH_MISMATCH"));

        // 5. Patch succeeds with correct hash and unique target
        let patch_res = patch_file_strict(&proj_path, "src/hello.txt", &new_hash, "Updated", "Patched");
        assert!(patch_res.is_ok());
        let (_old, new_content, _new_hash) = patch_res.unwrap();
        assert_eq!(new_content, "Patched content");

        // 6. Delete requires approved=true
        assert!(delete_file_strict(&proj_path, "src/hello.txt", false).is_err());
        assert!(delete_file_strict(&proj_path, "src/hello.txt", true).is_ok());

        // Cleanup
        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_actor_boundary_blocks_agent_raw_write() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();
        let proj_path = temp_dir.to_string_lossy().to_string();

        // 1. Agent actor attempting to use generic write_file MUST be rejected
        let agent_payload = serde_json::json!({
            "path": "src/danger.ts",
            "content": "bypassing changeset engine",
            "agent_task_id": "task-hack-123"
        });
        let res = handle("write_file", &agent_payload, Some(&proj_path), Some("developer")).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("ARCHITECTURAL_VIOLATION"));

        // 2. Direct user manual save is permitted
        let user_payload = serde_json::json!({
            "path": "src/user_save.ts",
            "content": "console.log('manual user save');"
        });
        let user_res = handle("write_file", &user_payload, Some(&proj_path), Some("developer")).await;
        assert!(user_res.is_ok());
        assert!(temp_dir.join("src/user_save.ts").exists());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}


