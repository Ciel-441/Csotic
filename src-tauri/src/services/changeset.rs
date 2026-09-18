//! # ChangeSet & Rollback Engine
//!
//! ## Architectural Model: Compensating Transaction (Saga Pattern)
//! Filesystem mutations in Forge are executed as **Compensating Transactions (Sagas)** with:
//! 1. **Pre-flight Invariant Validation**: Before modifying disk, operations are validated against `ProjectState` and `WorkspaceTruth`.
//! 2. **Turn Savepoints**: Each turn's operations are tracked by `turn_idx` and sequence number.
//! 3. **Durable Undo Journaling**: File before-states (full original content or hash) and inverse actions are synchronously persisted to SQLite (`rollback_journal_entries`).
//! 4. **Compensating Rollback**: If an operation fails, Forge triggers compensation:
//!    - Turn-level rollback (`rollback_turn`) rolls back partial mutations of that turn to restore the turn savepoint.
//!    - Task-level rollback (`rollback_task`) rolls back all mutations across all turns for the task.
//! 5. **Crash Resilience**: Rollback records survive application crashes and restarts via durable SQLite storage.

use std::collections::HashMap;
use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use rusqlite::Connection;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ChangeSetState {
    Planned,
    Reading,
    Validating,
    Ready,
    Applying,
    Applied,
    Partial,
    Verified,
    Rejected,
    Conflict,
    ValidationFailed,
    RolledBack,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum TaskMode {
    ModifyExistingProject,
    CreateNewProject,
    Explore,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ChangeOperation {
    Create {
        path: String,
        content: String,
    },
    Modify {
        path: String,
        expected_hash: String,
        new_content: String,
    },
    Patch {
        path: String,
        expected_hash: String,
        target: String,
        replacement: String,
    },
    Delete {
        path: String,
        approved: bool,
    },
    Move {
        source: String,
        destination: String,
    },
    Copy {
        source: String,
        destination: String,
    },
    CreateDirectory {
        path: String,
    },
    Replace {
        path: String,
        expected_hash: String,
        new_content: String,
    },
    NoOp {
        reason: String,
    },
}

impl ChangeOperation {
    pub fn target_path(&self) -> &str {
        match self {
            ChangeOperation::Create { path, .. } => path,
            ChangeOperation::Modify { path, .. } => path,
            ChangeOperation::Patch { path, .. } => path,
            ChangeOperation::Delete { path, .. } => path,
            ChangeOperation::Move { destination, .. } => destination,
            ChangeOperation::Copy { destination, .. } => destination,
            ChangeOperation::CreateDirectory { path } => path,
            ChangeOperation::Replace { path, .. } => path,
            ChangeOperation::NoOp { .. } => "",
        }
    }

    pub fn op_type(&self) -> &'static str {
        match self {
            ChangeOperation::Create { .. } => "CREATE",
            ChangeOperation::Modify { .. } => "MODIFY",
            ChangeOperation::Patch { .. } => "PATCH",
            ChangeOperation::Delete { .. } => "DELETE",
            ChangeOperation::Move { .. } => "MOVE",
            ChangeOperation::Copy { .. } => "COPY",
            ChangeOperation::CreateDirectory { .. } => "CREATE_DIR",
            ChangeOperation::Replace { .. } => "REPLACE",
            ChangeOperation::NoOp { .. } => "NO_OP",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChangeSet {
    pub id: String,
    pub task_id: String,
    pub project_id: Option<String>,
    pub workspace_root: String,
    pub mode: TaskMode,
    pub reason: String,
    pub operations: Vec<ChangeOperation>,
    pub state: ChangeSetState,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollbackRecord {
    pub task_id: String,
    pub turn_idx: usize,
    pub sequence: usize,
    pub path: String,
    pub original_hash: String,
    pub original_content: Option<String>,
    pub was_newly_created: bool,
    pub hash_after_apply: Option<String>,
    pub source_path: Option<String>,
    pub destination_path: Option<String>,
    pub destination_before_state: Option<String>,
}

fn apply_rollback_record(project_path: &str, record: &RollbackRecord) -> Result<String, String> {
    // 1. Move / rename rollback
    if let (Some(src), Some(dest)) = (&record.source_path, &record.destination_path) {
        // Conflict Check: destination current hash must match the hash recorded when AI moved the file
        if let Ok((_curr_content, curr_hash)) = crate::services::filesystem::read_file_with_hash(project_path, dest) {
            if let Some(applied_hash) = &record.hash_after_apply {
                if &curr_hash != applied_hash && &curr_hash != &record.original_hash {
                    return Err(format!(
                        "ROLLBACK_CONFLICT: Moved file destination '{}' was modified after the AI moved it (Current: {}, Expected: {}). Preserving manual changes.",
                        dest,
                        &curr_hash[..8.min(curr_hash.len())],
                        &applied_hash[..8.min(applied_hash.len())]
                    ));
                }
            }
        } else {
            return Err(format!(
                "ROLLBACK_CONFLICT: Moved file destination '{}' no longer exists on disk. Cannot restore back to '{}'.",
                dest, src
            ));
        }

        // Conflict Check: source path must not already exist on disk
        if let Ok((_, _)) = crate::services::filesystem::read_file_with_hash(project_path, src) {
            return Err(format!(
                "ROLLBACK_CONFLICT: Cannot restore moved file '{}' to original path '{}' because '{}' already exists on disk. Preserving current files.",
                dest, src, src
            ));
        }

        if let Err(e) = crate::services::filesystem::move_file_strict(project_path, dest, src) {
            return Err(format!("Cannot restore moved file from '{}' to '{}': {}", dest, src, e));
        } else {
            if let Some(prev_dest_content) = &record.destination_before_state {
                let _ = crate::services::filesystem::restore_file_for_rollback(project_path, dest, prev_dest_content);
            }
            return Ok(format!("Moved '{}' back to '{}'", dest, src));
        }
    }

    // 2. Newly created file rollback (delete it)
    if record.was_newly_created {
        if let Ok((_curr_content, curr_hash)) = crate::services::filesystem::read_file_with_hash(project_path, &record.path) {
            if let Some(applied_hash) = &record.hash_after_apply {
                if &curr_hash != applied_hash {
                    return Err(format!(
                        "ROLLBACK_CONFLICT: '{}' was modified after the AI created it. Preserving manual changes.",
                        record.path
                    ));
                }
            }
        }
        match crate::services::filesystem::delete_file_strict(project_path, &record.path, true) {
            Ok(_) => Ok(format!("Deleted newly created {}", record.path)),
            Err(e) => Err(format!("Failed to delete newly created '{}': {}", record.path, e)),
        }
    } else if let Some(orig_content) = &record.original_content {
        // 3. Modified file rollback (restore original content)
        if let Ok((_curr_content, curr_hash)) = crate::services::filesystem::read_file_with_hash(project_path, &record.path) {
            if let Some(applied_hash) = &record.hash_after_apply {
                if &curr_hash != applied_hash && &curr_hash != &record.original_hash {
                    return Err(format!(
                        "ROLLBACK_CONFLICT: '{}' was modified after AI edit (Current: {}, Applied: {}). Preserving manual changes.",
                        record.path,
                        &curr_hash[..8.min(curr_hash.len())],
                        &applied_hash[..8.min(applied_hash.len())]
                    ));
                }
            }
        }

        match crate::services::filesystem::restore_file_for_rollback(project_path, &record.path, orig_content) {
            Ok(_) => Ok(format!(
                "Reverted {} to original state (hash: {})",
                record.path,
                &record.original_hash[..8.min(record.original_hash.len())]
            )),
            Err(e) => Err(format!("Failed to restore file '{}': {}", record.path, e)),
        }
    } else {
        Ok(format!("No content to restore for '{}'", record.path))
    }
}

#[derive(Debug, Default)]
pub struct RollbackJournal {
    journals: Mutex<HashMap<String, Vec<RollbackRecord>>>, // task_id -> records
}

impl RollbackJournal {
    pub fn new() -> Self {
        Self {
            journals: Mutex::new(HashMap::new()),
        }
    }

    pub fn record_original(
        &self,
        task_id: &str,
        turn_idx: usize,
        path: &str,
        hash: &str,
        content: Option<&str>,
        was_created: bool,
        db: Option<&Mutex<Connection>>,
    ) {
        let mut guard = self.journals.lock().unwrap();
        let list = guard.entry(task_id.to_string()).or_default();
        let seq = list.len();
        // Don't record if already recorded for this path (keep earliest before-state)
        if !list.iter().any(|r| r.path == path) {
            let record = RollbackRecord {
                task_id: task_id.to_string(),
                turn_idx,
                sequence: seq,
                path: path.to_string(),
                original_hash: hash.to_string(),
                original_content: content.map(|s| s.to_string()),
                was_newly_created: was_created,
                hash_after_apply: None,
                source_path: None,
                destination_path: None,
                destination_before_state: None,
            };
            list.push(record.clone());

            // Synchronous Durable Persistence in SQLite
            if let Some(db_mutex) = db {
                if let Ok(conn) = db_mutex.lock() {
                    let entry_id = format!("rb_{}_{}", task_id, seq);
                    let now = chrono::Utc::now().to_rfc3339();
                    let _ = conn.execute(
                        "INSERT OR REPLACE INTO rollback_journal_entries (
                            id, task_id, turn_idx, sequence, path, original_hash, original_content,
                            was_newly_created, hash_after_apply, source_path, destination_path,
                            destination_before_state, created_at
                        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                        rusqlite::params![
                            entry_id,
                            task_id,
                            turn_idx as i64,
                            seq as i64,
                            record.path,
                            record.original_hash,
                            record.original_content,
                            if record.was_newly_created { 1 } else { 0 },
                            record.hash_after_apply,
                            record.source_path,
                            record.destination_path,
                            record.destination_before_state,
                            now,
                        ],
                    );
                }
            }
        }
    }

    pub fn record_applied_hash(&self, task_id: &str, path: &str, after_hash: &str, db: Option<&Mutex<Connection>>) {
        let mut guard = self.journals.lock().unwrap();
        if let Some(list) = guard.get_mut(task_id) {
            if let Some(record) = list.iter_mut().find(|r| r.path == path) {
                record.hash_after_apply = Some(after_hash.to_string());
                let seq = record.sequence;

                if let Some(db_mutex) = db {
                    if let Ok(conn) = db_mutex.lock() {
                        let entry_id = format!("rb_{}_{}", task_id, seq);
                        let _ = conn.execute(
                            "UPDATE rollback_journal_entries SET hash_after_apply = ?1 WHERE id = ?2 OR (task_id = ?3 AND path = ?4)",
                            rusqlite::params![after_hash, entry_id, task_id, path],
                        );
                    }
                }
            }
        }
    }

    pub fn record_move(
        &self,
        task_id: &str,
        turn_idx: usize,
        source: &str,
        dest: &str,
        source_hash: &str,
        dest_content_before: Option<&str>,
        db: Option<&Mutex<Connection>>,
    ) {
        let mut guard = self.journals.lock().unwrap();
        let list = guard.entry(task_id.to_string()).or_default();
        let seq = list.len();
        let record = RollbackRecord {
            task_id: task_id.to_string(),
            turn_idx,
            sequence: seq,
            path: dest.to_string(),
            original_hash: source_hash.to_string(),
            original_content: None,
            was_newly_created: false,
            hash_after_apply: Some(source_hash.to_string()),
            source_path: Some(source.to_string()),
            destination_path: Some(dest.to_string()),
            destination_before_state: dest_content_before.map(|s| s.to_string()),
        };
        list.push(record.clone());

        if let Some(db_mutex) = db {
            if let Ok(conn) = db_mutex.lock() {
                let entry_id = format!("rb_{}_{}", task_id, seq);
                let now = chrono::Utc::now().to_rfc3339();
                let _ = conn.execute(
                    "INSERT OR REPLACE INTO rollback_journal_entries (
                        id, task_id, turn_idx, sequence, path, original_hash, original_content,
                        was_newly_created, hash_after_apply, source_path, destination_path,
                        destination_before_state, created_at
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                    rusqlite::params![
                        entry_id,
                        task_id,
                        turn_idx as i64,
                        seq as i64,
                        record.path,
                        record.original_hash,
                        record.original_content,
                        if record.was_newly_created { 1 } else { 0 },
                        record.hash_after_apply,
                        record.source_path,
                        record.destination_path,
                        record.destination_before_state,
                        now,
                    ],
                );
            }
        }
    }

    /// Persist current in-memory records to SQLite DB changesets table
    pub fn persist_to_db(&self, db: &Mutex<Connection>, task_id: &str, project_id: Option<&str>) -> Result<(), String> {
        let records = {
            let guard = self.journals.lock().unwrap();
            guard.get(task_id).cloned().unwrap_or_default()
        };

        let conn = db.lock().map_err(|e| format!("DB lock error: {e}"))?;
        let now = chrono::Utc::now().to_rfc3339();
        let changeset_id = format!("cs_{task_id}");

        conn.execute(
            "INSERT OR REPLACE INTO changesets (id, task_id, project_id, state, reason, created_at)
             VALUES (?1, ?2, ?3, 'Applied', 'Task Execution ChangeSet', ?4)",
            rusqlite::params![changeset_id, task_id, project_id, now],
        ).map_err(|e| format!("DB error saving changeset: {e}"))?;

        for (seq, rec) in records.iter().enumerate() {
            let op_id = format!("{}_{}", changeset_id, seq);
            let op_type = if rec.was_newly_created {
                "CREATE"
            } else if rec.source_path.is_some() {
                "MOVE"
            } else {
                "MODIFY"
            };

            conn.execute(
                "INSERT OR REPLACE INTO changeset_operations (
                    id, changeset_id, sequence, operation, path, source_path, destination_path,
                    expected_hash, before_hash, after_hash, status
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'applied')",
                rusqlite::params![
                    op_id,
                    changeset_id,
                    seq as i64,
                    op_type,
                    rec.path,
                    rec.source_path,
                    rec.destination_path,
                    rec.original_hash,
                    rec.original_hash,
                    rec.hash_after_apply,
                ],
            ).map_err(|e| format!("DB error saving changeset operation: {e}"))?;
        }

        Ok(())
    }

    /// Roll back only operations performed in a specific turn (Turn Savepoint Compensation)
    pub fn rollback_turn(
        &self,
        project_path: &str,
        task_id: &str,
        turn_idx: usize,
        db: Option<&Mutex<Connection>>,
    ) -> Result<Vec<String>, String> {
        // 1. Drain matching records from in-memory journal
        let mut records: Vec<RollbackRecord> = {
            let mut guard = self.journals.lock().unwrap();
            if let Some(list) = guard.get_mut(task_id) {
                let (matching, remaining): (Vec<_>, Vec<_>) = list.drain(..).partition(|r| r.turn_idx == turn_idx);
                *list = remaining;
                matching
            } else {
                Vec::new()
            }
        };

        // 2. If memory was empty, check SQLite durable storage for this turn
        if records.is_empty() {
            if let Some(db_mutex) = db {
                if let Ok(conn) = db_mutex.lock() {
                    let mut stmt = conn.prepare(
                        "SELECT id, task_id, turn_idx, sequence, path, original_hash, original_content,
                                was_newly_created, hash_after_apply, source_path, destination_path,
                                destination_before_state
                         FROM rollback_journal_entries
                         WHERE task_id = ?1 AND turn_idx = ?2
                         ORDER BY sequence DESC"
                    ).map_err(|e| format!("DB prepare error: {e}"))?;

                    let rows = stmt.query_map(rusqlite::params![task_id, turn_idx as i64], |row| {
                        let was_created: i64 = row.get(7)?;
                        Ok(RollbackRecord {
                            task_id: row.get(1)?,
                            turn_idx: row.get::<_, i64>(2)? as usize,
                            sequence: row.get::<_, i64>(3)? as usize,
                            path: row.get(4)?,
                            original_hash: row.get(5)?,
                            original_content: row.get(6)?,
                            was_newly_created: was_created == 1,
                            hash_after_apply: row.get(8)?,
                            source_path: row.get(9)?,
                            destination_path: row.get(10)?,
                            destination_before_state: row.get(11)?,
                        })
                    }).map_err(|e| format!("DB query error: {e}"))?;

                    for r in rows.flatten() {
                        records.push(r);
                    }
                }
            }
        } else {
            // Sort in reverse sequence order
            records.sort_by(|a, b| b.sequence.cmp(&a.sequence));
        }

        if records.is_empty() {
            return Ok(vec![]);
        }

        let mut reverted_files = Vec::new();
        let mut conflicts = Vec::new();

        for record in &records {
            match apply_rollback_record(project_path, record) {
                Ok(msg) => reverted_files.push(msg),
                Err(e) => conflicts.push(e),
            }
        }

        // Clean up SQLite records for this turn
        if let Some(db_mutex) = db {
            if let Ok(conn) = db_mutex.lock() {
                let _ = conn.execute(
                    "DELETE FROM rollback_journal_entries WHERE task_id = ?1 AND turn_idx = ?2",
                    rusqlite::params![task_id, turn_idx as i64],
                );
            }
        }

        if !conflicts.is_empty() {
            if reverted_files.is_empty() {
                return Err(conflicts.join("\n"));
            } else {
                return Err(format!("Partial turn rollback with conflicts:\n{}\nReverted:\n{}", conflicts.join("\n"), reverted_files.join("\n")));
            }
        }

        Ok(reverted_files)
    }

    /// Roll back all operations in reverse order, verifying disk hashes to prevent overwriting user edits.
    /// Fully crash-resilient: if in-memory journal is empty (e.g. after app restart), loads from SQLite.
    pub fn rollback_task(
        &self,
        project_path: &str,
        task_id: &str,
        db: Option<&Mutex<Connection>>,
    ) -> Result<Vec<String>, String> {
        let mut records = {
            let mut guard = self.journals.lock().unwrap();
            guard.remove(task_id).unwrap_or_default()
        };

        // If memory is empty (e.g. after crash / restart), load from durable SQLite table
        if records.is_empty() {
            if let Some(db_mutex) = db {
                if let Ok(conn) = db_mutex.lock() {
                    let mut stmt = conn.prepare(
                        "SELECT id, task_id, turn_idx, sequence, path, original_hash, original_content,
                                was_newly_created, hash_after_apply, source_path, destination_path,
                                destination_before_state
                         FROM rollback_journal_entries
                         WHERE task_id = ?1
                         ORDER BY sequence DESC"
                    ).map_err(|e| format!("DB prepare error: {e}"))?;

                    let rows = stmt.query_map(rusqlite::params![task_id], |row| {
                        let was_created: i64 = row.get(7)?;
                        Ok(RollbackRecord {
                            task_id: row.get(1)?,
                            turn_idx: row.get::<_, i64>(2)? as usize,
                            sequence: row.get::<_, i64>(3)? as usize,
                            path: row.get(4)?,
                            original_hash: row.get(5)?,
                            original_content: row.get(6)?,
                            was_newly_created: was_created == 1,
                            hash_after_apply: row.get(8)?,
                            source_path: row.get(9)?,
                            destination_path: row.get(10)?,
                            destination_before_state: row.get(11)?,
                        })
                    }).map_err(|e| format!("DB query error: {e}"))?;

                    for r in rows.flatten() {
                        records.push(r);
                    }
                }
            }
        } else {
            records.sort_by(|a, b| b.sequence.cmp(&a.sequence));
        }

        if records.is_empty() {
            return Ok(vec!["No changes to rollback for this task.".to_string()]);
        }

        let mut reverted_files = Vec::new();
        let mut conflicts = Vec::new();

        for record in &records {
            match apply_rollback_record(project_path, record) {
                Ok(msg) => reverted_files.push(msg),
                Err(e) => conflicts.push(e),
            }
        }

        // Clean up SQLite records for this task
        if let Some(db_mutex) = db {
            if let Ok(conn) = db_mutex.lock() {
                let _ = conn.execute(
                    "DELETE FROM rollback_journal_entries WHERE task_id = ?1",
                    rusqlite::params![task_id],
                );
            }
        }

        if !conflicts.is_empty() {
            if reverted_files.is_empty() {
                return Err(conflicts.join("\n"));
            } else {
                return Err(format!("Partial rollback with conflicts:\n{}\nReverted:\n{}", conflicts.join("\n"), reverted_files.join("\n")));
            }
        }

        Ok(reverted_files)
    }

    pub fn clear_task(&self, task_id: &str, db: Option<&Mutex<Connection>>) {
        let mut guard = self.journals.lock().unwrap();
        guard.remove(task_id);

        if let Some(db_mutex) = db {
            if let Ok(conn) = db_mutex.lock() {
                let _ = conn.execute(
                    "DELETE FROM rollback_journal_entries WHERE task_id = ?1",
                    rusqlite::params![task_id],
                );
            }
        }
    }
}

pub static GLOBAL_ROLLBACK_JOURNAL: std::sync::OnceLock<RollbackJournal> = std::sync::OnceLock::new();

pub fn get_rollback_journal() -> &'static RollbackJournal {
    GLOBAL_ROLLBACK_JOURNAL.get_or_init(RollbackJournal::new)
}

/// Validates ChangeSet invariants before applying
pub struct ChangeSetValidator;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationSummary {
    pub is_valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
    pub files_created: usize,
    pub files_modified: usize,
    pub files_deleted: usize,
}

impl ChangeSetValidator {
    pub fn validate(
        project_state: &crate::services::project_state::ProjectState,
        changeset: &ChangeSet,
    ) -> ValidationSummary {
        let mut errors = Vec::new();
        let mut warnings = Vec::new();
        let mut files_created = 0;
        let mut files_modified = 0;
        let mut files_deleted = 0;

        let mut seen_creates = std::collections::HashSet::new();
        let mut seen_deletes = std::collections::HashSet::new();
        let mut seen_paths = std::collections::HashSet::new();

        for op in &changeset.operations {
            let path = op.target_path();
            
            // Check for duplicate or conflicting operations on the same path
            if !path.is_empty() {
                match op {
                    ChangeOperation::Create { .. } => {
                        if seen_creates.contains(path) {
                            errors.push(format!("DUPLICATE_CREATE_OPERATION: Multiple create operations planned on the same path '{}'. Operations must be normalized before execution.", path));
                        }
                        if seen_deletes.contains(path) {
                            warnings.push(format!("Re-creating path '{}' that was marked for deletion in the same batch.", path));
                        }
                        seen_creates.insert(path.to_string());
                    }
                    ChangeOperation::Delete { .. } => {
                        if seen_deletes.contains(path) {
                            errors.push(format!("DUPLICATE_DELETE_OPERATION: Multiple delete operations planned on the same path '{}'.", path));
                        }
                        seen_deletes.insert(path.to_string());
                    }
                    _ => {
                        if seen_deletes.contains(path) {
                            errors.push(format!("CONFLICTING_OPERATION: Modifying path '{}' after it was deleted in the same batch.", path));
                        }
                    }
                }

                if seen_paths.contains(path) && !seen_creates.contains(path) && !seen_deletes.contains(path) {
                    warnings.push(format!("Multiple operations detected on same path '{}'. Operations should be normalized.", path));
                }
                seen_paths.insert(path.to_string());
            }

            match op {
                ChangeOperation::Create { path, content } => {
                    files_created += 1;
                    if path.trim().is_empty() {
                        errors.push("Invalid path: file path cannot be empty.".to_string());
                    }
                    if crate::services::project_state::ProjectDetector::is_suspicious_recreation(project_state, path) {
                        errors.push(format!(
                            "PROJECT_RECREATION_DETECTED: '{}' already exists or is a root manifest in this project. Modifying or patching should be used instead of recreation.",
                            path
                        ));
                    }
                    if let Some((duplicate_of, reason)) = crate::services::project_state::ProjectDetector::find_semantic_duplication_with_content(project_state, path, Some(content)) {
                        warnings.push(format!(
                            "SEMANTIC_DUPLICATION_WARNING: Proposed new file '{}' appears to duplicate existing file '{}' ({}). Verify if modifying '{}' is preferred.",
                            path, duplicate_of, reason, duplicate_of
                        ));
                    }
                }
                ChangeOperation::Modify { path, expected_hash, .. } => {
                    files_modified += 1;
                    if path.trim().is_empty() {
                        errors.push("Invalid path: file path cannot be empty.".to_string());
                    }
                    if expected_hash.trim().is_empty() {
                        warnings.push(format!("Modify on '{}' has empty expected_hash; optimistic concurrency check disabled.", path));
                    }
                }
                ChangeOperation::Patch { path, expected_hash, target, .. } => {
                    files_modified += 1;
                    if path.trim().is_empty() {
                        errors.push("Invalid path: file path cannot be empty.".to_string());
                    }
                    if target.trim().is_empty() {
                        errors.push(format!("Patch on '{}' has empty target string.", path));
                    }
                    if expected_hash.trim().is_empty() {
                        warnings.push(format!("Patch on '{}' has empty expected_hash.", path));
                    }
                }
                ChangeOperation::Delete { path, approved } => {
                    files_deleted += 1;
                    if path.trim().is_empty() {
                        errors.push("Invalid path: file path cannot be empty.".to_string());
                    }
                    if !approved {
                        errors.push(format!("PERMISSION_DENIED: Deletion of '{}' requires explicit approved=true confirmation.", path));
                    }
                }
                ChangeOperation::Move { source, destination } => {
                    if source.trim().is_empty() || destination.trim().is_empty() {
                        errors.push("Invalid move: source and destination paths cannot be empty.".to_string());
                    }
                    if source == destination {
                        errors.push(format!("Invalid move: source and destination are identical ('{}').", source));
                    }
                }
                ChangeOperation::Copy { source, destination } => {
                    if source.trim().is_empty() || destination.trim().is_empty() {
                        errors.push("Invalid copy: source and destination paths cannot be empty.".to_string());
                    }
                    if source == destination {
                        errors.push(format!("Invalid copy: source and destination are identical ('{}').", source));
                    }
                }
                ChangeOperation::CreateDirectory { path } => {
                    if path.trim().is_empty() {
                        errors.push("Invalid create directory: path is empty.".to_string());
                    }
                }
                ChangeOperation::Replace { path, expected_hash, .. } => {
                    files_modified += 1;
                    if path.trim().is_empty() {
                        errors.push("Invalid path: file path cannot be empty.".to_string());
                    }
                    if expected_hash.trim().is_empty() {
                        warnings.push(format!("Replace on '{}' has empty expected_hash.", path));
                    }
                }
                ChangeOperation::NoOp { .. } => {}
            }
        }

        // Anomaly Check: Mass modification detection
        if files_modified + files_created > 20 {
            warnings.push(format!(
                "MASS_CHANGE_DETECTED: ChangeSet touches {} files simultaneously. Verify that this broad scope is expected.",
                files_modified + files_created
            ));
        }

        let is_valid = errors.is_empty();

        ValidationSummary {
            is_valid,
            errors,
            warnings,
            files_created,
            files_modified,
            files_deleted,
        }
    }
}

#[derive(Debug)]
pub struct OperationOutcome {
    pub success: bool,
    pub output_message: String,
    pub file_diff: Option<crate::events::FileDiff>,
    pub new_hash: Option<String>,
}

/// The transactional execution engine that mediates all agent file modifications
pub struct ChangeSetEngine;

impl ChangeSetEngine {
    /// Initialize a task changeset in the database with state = 'Planned'
    pub fn initialize_task_changeset(
        db: &Mutex<Connection>,
        task_id: &str,
        project_id: Option<&str>,
        _workspace_root: &str,
        reason: &str,
    ) -> Result<(), String> {
        let conn = db.lock().map_err(|e| format!("DB lock error: {e}"))?;
        let now = chrono::Utc::now().to_rfc3339();
        let changeset_id = format!("cs_{task_id}");
        conn.execute(
            "INSERT OR REPLACE INTO changesets (id, task_id, project_id, state, reason, created_at)
             VALUES (?1, ?2, ?3, 'Planned', ?4, ?5)",
            rusqlite::params![changeset_id, task_id, project_id, reason, now],
        ).map_err(|e| format!("DB error initializing changeset: {e}"))?;
        Ok(())
    }

    /// Validate all operations in a turn before executing any of them.
    pub fn validate_turn_operations(
        project_state: &crate::services::project_state::ProjectState,
        task_id: &str,
        project_id: Option<&str>,
        workspace_root: &str,
        operations: &[ChangeOperation],
    ) -> ValidationSummary {
        let changeset = ChangeSet {
            id: format!("cs_turn_{task_id}"),
            task_id: task_id.to_string(),
            project_id: project_id.map(|s| s.to_string()),
            workspace_root: workspace_root.to_string(),
            mode: TaskMode::ModifyExistingProject,
            reason: format!("Turn batch validation of {} operations", operations.len()),
            operations: operations.to_vec(),
            state: ChangeSetState::Validating,
            created_at: chrono::Utc::now().timestamp() as u64,
        };

        ChangeSetValidator::validate(project_state, &changeset)
    }

    /// Execute a ChangeOperation with strict compensating transaction (saga) guarantees:
    /// 1. ChangeSet is constructed in state Validating
    /// 2. ChangeSetValidator validates project invariants BEFORE touching disk
    /// 3. If validation fails -> ChangeSetState::ValidationFailed, recorded in DB, returns Err (disk untouched)
    /// 4. ChangeSetState::Applying -> Snapshot taken into durable RollbackJournal (in-memory + SQLite)
    /// 5. Filesystem mutation executed
    /// 6. If mutation fails -> ChangeSetState::RolledBack, turn savepoint compensated, DB updated, returns Err
    /// 7. If mutation succeeds -> ChangeSetState::Applied, Journal & ReadTracker updated, DB recorded in real-time, returns Ok
    pub async fn execute_operation_transactional(
        project_path: &str,
        project_state: &crate::services::project_state::ProjectState,
        task_id: &str,
        turn_idx: usize,
        project_id: Option<&str>,
        db: &Mutex<Connection>,
        read_tracker: &tokio::sync::Mutex<HashMap<String, String>>,
        op: ChangeOperation,
    ) -> Result<OperationOutcome, String> {
        let changeset_id = format!("cs_{task_id}");

        // 1. Construct ChangeSet
        let mut changeset = ChangeSet {
            id: changeset_id.clone(),
            task_id: task_id.to_string(),
            project_id: project_id.map(|s| s.to_string()),
            workspace_root: project_path.to_string(),
            mode: TaskMode::ModifyExistingProject,
            reason: format!("Tool execution: {}", op.op_type()),
            operations: vec![op.clone()],
            state: ChangeSetState::Validating,
            created_at: chrono::Utc::now().timestamp() as u64,
        };

        // 2. Run ChangeSetValidator BEFORE touching disk
        let summary = ChangeSetValidator::validate(project_state, &changeset);
        if !summary.is_valid {
            changeset.state = ChangeSetState::ValidationFailed;
            Self::record_op_failed(db, &changeset_id, &op, op.target_path(), &summary.errors.join("; "));
            return Err(summary.errors.join("\n"));
        }

        // 2b. Run WorkspaceTruth invariant verification against target file in O(1)
        let is_create = matches!(op, ChangeOperation::Create { .. });
        let expected_hash: Option<&str> = match &op {
            ChangeOperation::Modify { expected_hash, .. } => Some(expected_hash.as_str()),
            ChangeOperation::Patch { expected_hash, .. } => Some(expected_hash.as_str()),
            ChangeOperation::Replace { expected_hash, .. } => Some(expected_hash.as_str()),
            _ => None,
        };
        if let Err(truth_err) = crate::services::truth::WorkspaceTruth::verify_target_fast(project_path, op.target_path(), expected_hash, is_create) {
            changeset.state = ChangeSetState::ValidationFailed;
            Self::record_op_failed(db, &changeset_id, &op, op.target_path(), &truth_err);
            return Err(truth_err);
        }

        // 3. Transition to Applying
        changeset.state = ChangeSetState::Applying;
        if let Ok(conn) = db.lock() {
            let _ = conn.execute(
                "UPDATE changesets SET state = 'Applying' WHERE id = ?1",
                rusqlite::params![changeset_id],
            );
        }

        let journal = get_rollback_journal();

        // 4. Execute operation
        match op {
            ChangeOperation::Create { ref path, ref content } => {
                let clean_path = path.trim().replace('\\', "/").trim_start_matches('/').to_string();
                match crate::services::filesystem::create_file_strict(project_path, &clean_path, content) {
                    Ok(new_hash) => {
                        read_tracker.lock().await.insert(clean_path.clone(), new_hash.clone());
                        journal.record_original(task_id, turn_idx, &clean_path, &new_hash, None, true, Some(db));
                        journal.record_applied_hash(task_id, &clean_path, &new_hash, Some(db));
                        Self::record_op_applied(db, &changeset_id, &op, &clean_path, None, None, &new_hash);

                        Ok(OperationOutcome {
                            success: true,
                            output_message: format!("File '{}' created successfully (SHA-256: {}).", path, new_hash),
                            file_diff: Some(crate::events::FileDiff {
                                path: path.to_string(),
                                old_content: String::new(),
                                new_content: content.to_string(),
                            }),
                            new_hash: Some(new_hash),
                        })
                    }
                    Err(e) => {
                        Self::record_op_failed(db, &changeset_id, &op, &clean_path, &e);
                        Err(e)
                    }
                }
            }
            ChangeOperation::Modify { ref path, ref expected_hash, ref new_content } => {
                let clean_path = path.trim().replace('\\', "/").trim_start_matches('/').to_string();
                let effective_expected_hash = if !expected_hash.trim().is_empty() {
                    expected_hash.clone()
                } else if let Some(h) = read_tracker.lock().await.get(&clean_path).cloned() {
                    h
                } else {
                    return Err(format!("ERROR: READ_REQUIRED_BEFORE_MODIFY: You must call 'read_file' on '{}' before modifying it.", path));
                };

                match crate::services::filesystem::modify_file_strict(project_path, &clean_path, &effective_expected_hash, new_content) {
                    Ok((old_content, new_hash)) => {
                        read_tracker.lock().await.insert(clean_path.clone(), new_hash.clone());
                        journal.record_original(task_id, turn_idx, &clean_path, &effective_expected_hash, Some(&old_content), false, Some(db));
                        journal.record_applied_hash(task_id, &clean_path, &new_hash, Some(db));
                        Self::record_op_applied(db, &changeset_id, &op, &clean_path, None, Some(&effective_expected_hash), &new_hash);

                        Ok(OperationOutcome {
                            success: true,
                            output_message: format!("File '{}' modified successfully (SHA-256: {}).", path, new_hash),
                            file_diff: Some(crate::events::FileDiff {
                                path: path.to_string(),
                                old_content,
                                new_content: new_content.to_string(),
                            }),
                            new_hash: Some(new_hash),
                        })
                    }
                    Err(e) => {
                        Self::record_op_failed(db, &changeset_id, &op, &clean_path, &e);
                        Err(e)
                    }
                }
            }
            ChangeOperation::Patch { ref path, ref expected_hash, ref target, ref replacement } => {
                let clean_path = path.trim().replace('\\', "/").trim_start_matches('/').to_string();
                let effective_expected_hash = if !expected_hash.trim().is_empty() {
                    expected_hash.clone()
                } else if let Some(h) = read_tracker.lock().await.get(&clean_path).cloned() {
                    h
                } else {
                    return Err(format!("ERROR: READ_REQUIRED_BEFORE_MODIFY: You must call 'read_file' on '{}' before patching it.", path));
                };

                match crate::services::filesystem::patch_file_strict(project_path, &clean_path, &effective_expected_hash, target, replacement) {
                    Ok((old_content, new_content, new_hash)) => {
                        read_tracker.lock().await.insert(clean_path.clone(), new_hash.clone());
                        journal.record_original(task_id, turn_idx, &clean_path, &effective_expected_hash, Some(&old_content), false, Some(db));
                        journal.record_applied_hash(task_id, &clean_path, &new_hash, Some(db));
                        Self::record_op_applied(db, &changeset_id, &op, &clean_path, None, Some(&effective_expected_hash), &new_hash);

                        Ok(OperationOutcome {
                            success: true,
                            output_message: format!("File '{}' patched successfully (SHA-256: {}).", path, new_hash),
                            file_diff: Some(crate::events::FileDiff {
                                path: path.to_string(),
                                old_content,
                                new_content,
                            }),
                            new_hash: Some(new_hash),
                        })
                    }
                    Err(e) => {
                        Self::record_op_failed(db, &changeset_id, &op, &clean_path, &e);
                        Err(e)
                    }
                }
            }
            ChangeOperation::Replace { ref path, ref expected_hash, ref new_content } => {
                let clean_path = path.trim().replace('\\', "/").trim_start_matches('/').to_string();
                let effective_expected_hash = if !expected_hash.trim().is_empty() {
                    expected_hash.clone()
                } else if let Some(h) = read_tracker.lock().await.get(&clean_path).cloned() {
                    h
                } else {
                    return Err(format!("ERROR: READ_REQUIRED_BEFORE_MODIFY: You must call 'read_file' on '{}' before replacing it.", path));
                };

                match crate::services::filesystem::replace_file_strict(project_path, &clean_path, &effective_expected_hash, new_content) {
                    Ok((old_content, new_hash)) => {
                        read_tracker.lock().await.insert(clean_path.clone(), new_hash.clone());
                        journal.record_original(task_id, turn_idx, &clean_path, &effective_expected_hash, Some(&old_content), false, Some(db));
                        journal.record_applied_hash(task_id, &clean_path, &new_hash, Some(db));
                        Self::record_op_applied(db, &changeset_id, &op, &clean_path, None, Some(&effective_expected_hash), &new_hash);

                        Ok(OperationOutcome {
                            success: true,
                            output_message: format!("File '{}' replaced successfully (SHA-256: {}).", path, new_hash),
                            file_diff: Some(crate::events::FileDiff {
                                path: path.to_string(),
                                old_content,
                                new_content: new_content.to_string(),
                            }),
                            new_hash: Some(new_hash),
                        })
                    }
                    Err(e) => {
                        Self::record_op_failed(db, &changeset_id, &op, &clean_path, &e);
                        Err(e)
                    }
                }
            }
            ChangeOperation::Delete { ref path, approved } => {
                let clean_path = path.trim().replace('\\', "/").trim_start_matches('/').to_string();
                if let Ok(old_content) = crate::services::filesystem::read_file_str(project_path, &clean_path) {
                    let old_hash = crate::services::filesystem::compute_sha256(&old_content);
                    journal.record_original(task_id, turn_idx, &clean_path, &old_hash, Some(&old_content), false, Some(db));
                }

                match crate::services::filesystem::delete_file_strict(project_path, &clean_path, approved) {
                    Ok(_) => {
                        read_tracker.lock().await.remove(&clean_path);
                        Self::record_op_applied(db, &changeset_id, &op, &clean_path, None, None, "");
                        Ok(OperationOutcome {
                            success: true,
                            output_message: format!("Deleted '{}' successfully.", path),
                            file_diff: None,
                            new_hash: None,
                        })
                    }
                    Err(e) => {
                        Self::record_op_failed(db, &changeset_id, &op, &clean_path, &e);
                        Err(e)
                    }
                }
            }
            ChangeOperation::Move { ref source, ref destination } => {
                let dest_before = crate::services::filesystem::read_file_str(project_path, destination).ok();
                match crate::services::filesystem::move_file_strict(project_path, source, destination) {
                    Ok(_) => {
                        let mut guard = read_tracker.lock().await;
                        let hash = guard.remove(source).unwrap_or_default();
                        if !hash.is_empty() {
                            guard.insert(destination.to_string(), hash.clone());
                        }
                        journal.record_move(task_id, turn_idx, source, destination, &hash, dest_before.as_deref(), Some(db));
                        Self::record_op_applied(db, &changeset_id, &op, destination, Some(source), Some(&hash), &hash);

                        Ok(OperationOutcome {
                            success: true,
                            output_message: format!("Moved '{}' -> '{}' successfully.", source, destination),
                            file_diff: None,
                            new_hash: if hash.is_empty() { None } else { Some(hash) },
                        })
                    }
                    Err(e) => {
                        Self::record_op_failed(db, &changeset_id, &op, destination, &e);
                        Err(e)
                    }
                }
            }
            ChangeOperation::Copy { ref source, ref destination } => {
                match crate::services::filesystem::copy_file_strict(project_path, source, destination) {
                    Ok(dest_hash) => {
                        read_tracker.lock().await.insert(destination.to_string(), dest_hash.clone());
                        journal.record_original(task_id, turn_idx, destination, &dest_hash, None, true, Some(db));
                        journal.record_applied_hash(task_id, destination, &dest_hash, Some(db));
                        Self::record_op_applied(db, &changeset_id, &op, destination, Some(source), None, &dest_hash);

                        Ok(OperationOutcome {
                            success: true,
                            output_message: format!("Copied '{}' -> '{}' successfully (SHA-256: {}).", source, destination, dest_hash),
                            file_diff: None,
                            new_hash: Some(dest_hash),
                        })
                    }
                    Err(e) => {
                        Self::record_op_failed(db, &changeset_id, &op, destination, &e);
                        Err(e)
                    }
                }
            }
            ChangeOperation::CreateDirectory { ref path } => {
                let clean_path = path.trim().replace('\\', "/").trim_start_matches('/').to_string();
                match crate::services::filesystem::create_dir_strict(project_path, &clean_path) {
                    Ok(_) => {
                        Self::record_op_applied(db, &changeset_id, &op, &clean_path, None, None, "");
                        Ok(OperationOutcome {
                            success: true,
                            output_message: format!("Created directory '{}' successfully.", path),
                            file_diff: None,
                            new_hash: None,
                        })
                    }
                    Err(e) => {
                        Self::record_op_failed(db, &changeset_id, &op, &clean_path, &e);
                        Err(e)
                    }
                }
            }
            ChangeOperation::NoOp { ref reason } => {
                Ok(OperationOutcome {
                    success: true,
                    output_message: format!("NoOp: {}", reason),
                    file_diff: None,
                    new_hash: None,
                })
            }
        }
    }

    /// Finalize task changeset in DB
    pub fn finalize_task_changeset(
        db: &Mutex<Connection>,
        task_id: &str,
        final_state: ChangeSetState,
    ) -> Result<(), String> {
        let conn = db.lock().map_err(|e| format!("DB lock error: {e}"))?;
        let now = chrono::Utc::now().to_rfc3339();
        let changeset_id = format!("cs_{task_id}");
        let state_str = format!("{:?}", final_state);
        let applied_at = if final_state == ChangeSetState::Applied || final_state == ChangeSetState::Verified {
            Some(now.clone())
        } else {
            None
        };
        conn.execute(
            "UPDATE changesets SET state = ?1, applied_at = ?2 WHERE id = ?3",
            rusqlite::params![state_str, applied_at, changeset_id],
        ).map_err(|e| format!("DB error updating changeset state: {e}"))?;
        Ok(())
    }

    fn record_op_applied(
        db: &Mutex<Connection>,
        changeset_id: &str,
        op: &ChangeOperation,
        path: &str,
        source_path: Option<&str>,
        before_hash: Option<&str>,
        after_hash: &str,
    ) {
        if let Ok(conn) = db.lock() {
            let op_id = format!("{}_{}", changeset_id, chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
            let _ = conn.execute(
                "INSERT OR REPLACE INTO changeset_operations (
                    id, changeset_id, sequence, operation, path, source_path, destination_path,
                    expected_hash, before_hash, after_hash, status
                ) VALUES (?1, ?2, 0, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'applied')",
                rusqlite::params![
                    op_id,
                    changeset_id,
                    op.op_type(),
                    path,
                    source_path,
                    if op.op_type() == "MOVE" || op.op_type() == "COPY" { Some(path) } else { None },
                    before_hash,
                    before_hash,
                    after_hash,
                ],
            );
        }
    }

    fn record_op_failed(
        db: &Mutex<Connection>,
        changeset_id: &str,
        op: &ChangeOperation,
        path: &str,
        _error: &str,
    ) {
        if let Ok(conn) = db.lock() {
            let op_id = format!("{}_{}", changeset_id, chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0));
            let _ = conn.execute(
                "INSERT OR REPLACE INTO changeset_operations (
                    id, changeset_id, sequence, operation, path, source_path, destination_path,
                    expected_hash, before_hash, after_hash, status
                ) VALUES (?1, ?2, 0, ?3, ?4, NULL, NULL, NULL, NULL, NULL, 'failed')",
                rusqlite::params![
                    op_id,
                    changeset_id,
                    op.op_type(),
                    path,
                ],
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project_state::{ProjectDetector, ProjectState, ProjectType};

    fn make_mock_project_state() -> ProjectState {
        ProjectState {
            workspace_root: "C:/fake/project".to_string(),
            project_exists: true,
            project_type: ProjectType::ViteReact,
            project_type_name: "Vite Single Page App".to_string(),
            package_manager: "npm".to_string(),
            file_count: 25,
            directory_count: 5,
            entry_points: vec!["src/main.tsx".to_string(), "src/App.tsx".to_string()],
            important_files: vec!["package.json".to_string(), "vite.config.ts".to_string(), "tsconfig.json".to_string()],
            existing_files: vec!["src/main.tsx".to_string(), "src/App.tsx".to_string(), "src/components/Button.tsx".to_string()],
            is_git: true,
            summary: "Mock project state".to_string(),
        }
    }

    #[test]
    fn test_suspicious_recreation_flagged() {
        let state = make_mock_project_state();
        assert!(ProjectDetector::is_suspicious_recreation(&state, "package.json"));
        assert!(ProjectDetector::is_suspicious_recreation(&state, "vite.config.ts"));
        assert!(ProjectDetector::is_suspicious_recreation(&state, "sub-app/package.json"));
        assert!(!ProjectDetector::is_suspicious_recreation(&state, "src/components/Button.tsx"));
    }

    #[test]
    fn test_changeset_recreation_validation_error() {
        let state = make_mock_project_state();
        let changeset = ChangeSet {
            id: "cs-1".to_string(),
            task_id: "task-1".to_string(),
            project_id: None,
            workspace_root: "C:/fake/project".to_string(),
            mode: TaskMode::ModifyExistingProject,
            reason: "Add a button".to_string(),
            operations: vec![
                ChangeOperation::Create {
                    path: "package.json".to_string(),
                    content: "{}".to_string(),
                },
            ],
            state: ChangeSetState::Planned,
            created_at: 0,
        };

        let summary = ChangeSetValidator::validate(&state, &changeset);
        assert!(!summary.is_valid);
        assert!(summary.errors.iter().any(|e| e.contains("PROJECT_RECREATION_DETECTED")));
    }

    #[test]
    fn test_unapproved_deletion_rejected() {
        let state = make_mock_project_state();
        let changeset = ChangeSet {
            id: "cs-2".to_string(),
            task_id: "task-2".to_string(),
            project_id: None,
            workspace_root: "C:/fake/project".to_string(),
            mode: TaskMode::ModifyExistingProject,
            reason: "Delete file".to_string(),
            operations: vec![
                ChangeOperation::Delete {
                    path: "src/utils.ts".to_string(),
                    approved: false,
                },
            ],
            state: ChangeSetState::Planned,
            created_at: 0,
        };

        let summary = ChangeSetValidator::validate(&state, &changeset);
        assert!(!summary.is_valid);
        assert!(summary.errors.iter().any(|e| e.contains("PERMISSION_DENIED")));
    }

    #[test]
    fn test_valid_modify_changeset() {
        let state = make_mock_project_state();
        let changeset = ChangeSet {
            id: "cs-3".to_string(),
            task_id: "task-3".to_string(),
            project_id: None,
            workspace_root: "C:/fake/project".to_string(),
            mode: TaskMode::ModifyExistingProject,
            reason: "Update App component".to_string(),
            operations: vec![
                ChangeOperation::Modify {
                    path: "src/App.tsx".to_string(),
                    expected_hash: "a1b2c3d4e5f6".to_string(),
                    new_content: "export function App() { return <div>Hello</div>; }".to_string(),
                },
            ],
            state: ChangeSetState::Planned,
            created_at: 0,
        };

        let summary = ChangeSetValidator::validate(&state, &changeset);
        assert!(summary.is_valid);
        assert_eq!(summary.files_modified, 1);
        assert_eq!(summary.files_created, 0);
    }

    #[tokio::test]
    async fn test_changeset_engine_validation_blocks_disk_mutation() {
        let temp_dir = std::env::temp_dir().join(format!("forge_engine_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        let state = make_mock_project_state();
        let db_path = temp_dir.join("test1.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let db = Mutex::new(conn);
        let read_tracker = tokio::sync::Mutex::new(HashMap::new());

        // Attempt suspicious recreation of package.json
        let op = ChangeOperation::Create {
            path: "package.json".to_string(),
            content: "{\"name\": \"overwrite\"}".to_string(),
        };

        let res = ChangeSetEngine::execute_operation_transactional(
            project_path,
            &state,
            "task-v1",
            1,
            None,
            &db,
            &read_tracker,
            op,
        ).await;

        assert!(res.is_err());
        assert!(res.unwrap_err().contains("PROJECT_RECREATION_DETECTED"));

        // Verify disk was NOT modified / created
        assert!(!temp_dir.join("package.json").exists());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_changeset_engine_successful_create_and_modify() {
        let temp_dir = std::env::temp_dir().join(format!("forge_engine_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        let state = make_mock_project_state();
        let db_path = temp_dir.join("test2.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let db = Mutex::new(conn);
        let read_tracker = tokio::sync::Mutex::new(HashMap::new());

        // 1. Create new component file
        let op1 = ChangeOperation::Create {
            path: "src/components/Card.tsx".to_string(),
            content: "export const Card = () => <div/>;".to_string(),
        };

        let res1 = ChangeSetEngine::execute_operation_transactional(
            project_path,
            &state,
            "task-v2",
            1,
            None,
            &db,
            &read_tracker,
            op1,
        ).await;

        assert!(res1.is_ok());
        let outcome1 = res1.unwrap();
        assert!(outcome1.success);
        assert!(temp_dir.join("src/components/Card.tsx").exists());

        // 2. Modify component file
        let op2 = ChangeOperation::Modify {
            path: "src/components/Card.tsx".to_string(),
            expected_hash: outcome1.new_hash.unwrap(),
            new_content: "export const Card = () => <section>Card Content</section>;".to_string(),
        };

        let res2 = ChangeSetEngine::execute_operation_transactional(
            project_path,
            &state,
            "task-v2",
            1,
            None,
            &db,
            &read_tracker,
            op2,
        ).await;

        assert!(res2.is_ok());
        let content_on_disk = std::fs::read_to_string(temp_dir.join("src/components/Card.tsx")).unwrap();
        assert_eq!(content_on_disk, "export const Card = () => <section>Card Content</section>;");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_rollback_user_conflict_detection() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        // 1. Initial file
        let file_path = temp_dir.join("index.ts");
        std::fs::write(&file_path, "initial content").unwrap();
        let initial_hash = crate::services::filesystem::compute_sha256("initial content");

        // 2. AI modifies file
        let ai_content = "ai modified content";
        std::fs::write(&file_path, ai_content).unwrap();
        let ai_hash = crate::services::filesystem::compute_sha256(ai_content);

        let journal = RollbackJournal::new();
        journal.record_original("task-123", 1, "index.ts", &initial_hash, Some("initial content"), false, None);
        journal.record_applied_hash("task-123", "index.ts", &ai_hash, None);

        // 3. User manually modifies file after AI task
        let user_content = "user modified content";
        std::fs::write(&file_path, user_content).unwrap();

        // 4. Trigger rollback -> MUST detect conflict and fail
        let result = journal.rollback_task(project_path, "task-123", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("ROLLBACK_CONFLICT"));

        // Content remains the user's manual change
        let current_content = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(current_content, user_content);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_rollback_success_without_conflict() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        // 1. Initial file
        let file_path = temp_dir.join("index.ts");
        std::fs::write(&file_path, "initial content").unwrap();
        let initial_hash = crate::services::filesystem::compute_sha256("initial content");

        // 2. AI modifies file
        let ai_content = "ai modified content";
        std::fs::write(&file_path, ai_content).unwrap();
        let ai_hash = crate::services::filesystem::compute_sha256(ai_content);

        let journal = RollbackJournal::new();
        journal.record_original("task-124", 1, "index.ts", &initial_hash, Some("initial content"), false, None);
        journal.record_applied_hash("task-124", "index.ts", &ai_hash, None);

        // 3. Trigger rollback without user changes
        let result = journal.rollback_task(project_path, "task-124", None);
        assert!(result.is_ok());

        // File is restored to original content
        let current_content = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(current_content, "initial content");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_rollback_move() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        let dest_file = temp_dir.join("dest.ts");
        std::fs::write(&dest_file, "moved content").unwrap();
        let hash = crate::services::filesystem::compute_sha256("moved content");

        let journal = RollbackJournal::new();
        journal.record_move("task-125", 1, "src.ts", "dest.ts", &hash, None, None);

        let result = journal.rollback_task(project_path, "task-125", None);
        assert!(result.is_ok());

        let src_file = temp_dir.join("src.ts");
        assert!(src_file.exists());
        assert!(!dest_file.exists());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_rollback_turn_isolates_failure_to_current_turn() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        let db_path = temp_dir.join("test_turn.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let db = Mutex::new(conn);

        let journal = RollbackJournal::new();

        // Turn 1: Create Turn1_file.ts
        let t1_path = temp_dir.join("Turn1_file.ts");
        std::fs::write(&t1_path, "Turn 1 Content").unwrap();
        let t1_hash = crate::services::filesystem::compute_sha256("Turn 1 Content");
        journal.record_original("task-turn-1", 1, "Turn1_file.ts", &t1_hash, None, true, Some(&db));
        journal.record_applied_hash("task-turn-1", "Turn1_file.ts", &t1_hash, Some(&db));

        // Turn 2: Create Turn2_file.ts
        let t2_path = temp_dir.join("Turn2_file.ts");
        std::fs::write(&t2_path, "Turn 2 Content").unwrap();
        let t2_hash = crate::services::filesystem::compute_sha256("Turn 2 Content");
        journal.record_original("task-turn-1", 2, "Turn2_file.ts", &t2_hash, None, true, Some(&db));
        journal.record_applied_hash("task-turn-1", "Turn2_file.ts", &t2_hash, Some(&db));

        // Execute rollback only for Turn 2
        let result = journal.rollback_turn(project_path, "task-turn-1", 2, Some(&db));
        assert!(result.is_ok());
        let reverted = result.unwrap();
        assert_eq!(reverted.len(), 1);
        assert!(reverted[0].contains("Turn2_file.ts"));

        // Turn 2 file was deleted by rollback
        assert!(!t2_path.exists());
        // Turn 1 file remains INTACT!
        assert!(t1_path.exists());
        assert_eq!(std::fs::read_to_string(&t1_path).unwrap(), "Turn 1 Content");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[tokio::test]
    async fn test_durable_rollback_recovers_from_sqlite_after_crash() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        let db_path = temp_dir.join("test_durable.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let db = Mutex::new(conn);

        // 1. Initial file
        let file_path = temp_dir.join("config.json");
        std::fs::write(&file_path, "{\"env\": \"prod\"}").unwrap();
        let orig_hash = crate::services::filesystem::compute_sha256("{\"env\": \"prod\"}");

        // 2. AI modifies file with durable logging
        let ai_content = "{\"env\": \"dev\"}";
        std::fs::write(&file_path, ai_content).unwrap();
        let ai_hash = crate::services::filesystem::compute_sha256(ai_content);

        let journal = RollbackJournal::new();
        journal.record_original("task-durable-1", 1, "config.json", &orig_hash, Some("{\"env\": \"prod\"}"), false, Some(&db));
        journal.record_applied_hash("task-durable-1", "config.json", &ai_hash, Some(&db));

        // 3. Simulate process crash / restart: Create a BRAND NEW empty RollbackJournal instance
        let crashed_restart_journal = RollbackJournal::new();

        // 4. Trigger durable rollback (in-memory is empty, MUST load from SQLite table rollback_journal_entries!)
        let result = crashed_restart_journal.rollback_task(project_path, "task-durable-1", Some(&db));
        assert!(result.is_ok());

        // File is restored to original content from SQLite records!
        let restored_content = std::fs::read_to_string(&file_path).unwrap();
        assert_eq!(restored_content, "{\"env\": \"prod\"}");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_turn_level_batch_validation_catches_invalid_op_in_batch() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        // Existing package.json
        std::fs::write(temp_dir.join("package.json"), "{}").unwrap();
        let state = crate::services::project_state::ProjectDetector::detect(project_path);

        // Batch containing 1 valid create and 1 invalid suspicious recreation
        let operations = vec![
            ChangeOperation::Create {
                path: "src/utils/math.ts".to_string(),
                content: "export const add = (a: number, b: number) => a + b;".to_string(),
            },
            ChangeOperation::Create {
                path: "package.json".to_string(),
                content: "{\"name\": \"recreated\"}".to_string(),
            },
        ];

        let summary = ChangeSetEngine::validate_turn_operations(
            &state,
            "turn-task-99",
            None,
            project_path,
            &operations,
        );

        // Entire batch MUST be invalid before any execution
        assert!(!summary.is_valid);
        assert!(summary.errors.iter().any(|e| e.contains("PROJECT_RECREATION_DETECTED")));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_rollback_move_user_conflict_detection() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        let dest_file = temp_dir.join("dest.ts");
        std::fs::write(&dest_file, "moved content").unwrap();
        let hash = crate::services::filesystem::compute_sha256("moved content");

        let journal = RollbackJournal::new();
        journal.record_move("task-126", 1, "src.ts", "dest.ts", &hash, None, None);

        // User edits dest.ts after move
        std::fs::write(&dest_file, "user modified moved content").unwrap();

        // Rollback MUST detect conflict and refuse to move
        let result = journal.rollback_task(project_path, "task-126", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("ROLLBACK_CONFLICT"));

        // User edits on dest.ts remain intact
        assert_eq!(std::fs::read_to_string(&dest_file).unwrap(), "user modified moved content");
        assert!(!temp_dir.join("src.ts").exists());

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_rollback_move_source_already_exists_conflict() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        let dest_file = temp_dir.join("dest.ts");
        std::fs::write(&dest_file, "moved content").unwrap();
        let hash = crate::services::filesystem::compute_sha256("moved content");

        let journal = RollbackJournal::new();
        journal.record_move("task-127", 1, "src.ts", "dest.ts", &hash, None, None);

        // User creates a new src.ts before rollback
        let src_file = temp_dir.join("src.ts");
        std::fs::write(&src_file, "newly created src").unwrap();

        // Rollback MUST detect conflict and refuse to overwrite src.ts
        let result = journal.rollback_task(project_path, "task-127", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("ROLLBACK_CONFLICT"));

        // Both files remain intact
        assert_eq!(std::fs::read_to_string(&src_file).unwrap(), "newly created src");
        assert_eq!(std::fs::read_to_string(&dest_file).unwrap(), "moved content");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_semantic_duplication_detected() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir.join("src/context")).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        // Existing AuthProvider.tsx
        std::fs::write(temp_dir.join("src/context/AuthProvider.tsx"), "export const AuthProvider = () => {};").unwrap();
        let state = crate::services::project_state::ProjectDetector::detect(project_path);

        // Propose creating AuthenticationProvider.tsx
        let changeset = ChangeSet {
            id: "cs-sem-1".to_string(),
            task_id: "task-sem-1".to_string(),
            project_id: None,
            workspace_root: project_path.to_string(),
            mode: TaskMode::ModifyExistingProject,
            reason: "Add authentication provider".to_string(),
            state: ChangeSetState::Validating,
            operations: vec![ChangeOperation::Create {
                path: "src/providers/AuthenticationProvider.tsx".to_string(),
                content: "export const AuthenticationProvider = () => {};".to_string(),
            }],
            created_at: 0,
        };

        let summary = ChangeSetValidator::validate(&state, &changeset);
        assert!(summary.warnings.iter().any(|w| w.contains("SEMANTIC_DUPLICATION_WARNING")));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_semantic_duplication_user_session_manager_vs_session_controller() {
        let temp_dir = std::env::temp_dir().join(format!("forge_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir.join("src/services")).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        // Existing src/services/UserSessionManager.ts
        std::fs::write(
            temp_dir.join("src/services/UserSessionManager.ts"),
            "export class UserSessionManager { getSession() {} login() {} }",
        ).unwrap();
        let state = crate::services::project_state::ProjectDetector::detect(project_path);

        // AI proposes creating src/auth/SessionController.ts
        let changeset = ChangeSet {
            id: "cs-sem-2".to_string(),
            task_id: "task-sem-2".to_string(),
            project_id: None,
            workspace_root: project_path.to_string(),
            mode: TaskMode::ModifyExistingProject,
            reason: "Add session controller".to_string(),
            state: ChangeSetState::Validating,
            operations: vec![ChangeOperation::Create {
                path: "src/auth/SessionController.ts".to_string(),
                content: "export class SessionController { getSession() {} login() {} }".to_string(),
            }],
            created_at: 0,
        };

        let summary = ChangeSetValidator::validate(&state, &changeset);
        assert!(summary.warnings.iter().any(|w| w.contains("SEMANTIC_DUPLICATION_WARNING")));
        assert!(summary.warnings.iter().any(|w| w.contains("UserSessionManager.ts")));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_duplicate_create_operations_rejected_as_error() {
        let state = crate::services::project_state::ProjectState {
            workspace_root: ".".to_string(),
            project_exists: true,
            project_type: crate::services::project_state::ProjectType::Node,
            project_type_name: "node".to_string(),
            package_manager: "npm".to_string(),
            file_count: 5,
            directory_count: 2,
            entry_points: vec![],
            important_files: vec!["package.json".to_string()],
            existing_files: vec!["package.json".to_string()],
            is_git: false,
            summary: "Node project".to_string(),
        };

        let changeset = ChangeSet {
            id: "cs-dup-create".to_string(),
            task_id: "task-dup".to_string(),
            project_id: None,
            workspace_root: ".".to_string(),
            mode: TaskMode::ModifyExistingProject,
            reason: "Duplicate create test".to_string(),
            state: ChangeSetState::Validating,
            operations: vec![
                ChangeOperation::Create {
                    path: "src/utils/helpers.ts".to_string(),
                    content: "export const a = 1;".to_string(),
                },
                ChangeOperation::Create {
                    path: "src/utils/helpers.ts".to_string(),
                    content: "export const b = 2;".to_string(),
                },
            ],
            created_at: 0,
        };

        let summary = ChangeSetValidator::validate(&state, &changeset);
        assert!(!summary.is_valid);
        assert!(summary.errors.iter().any(|e| e.contains("DUPLICATE_CREATE_OPERATION")));
    }
}
