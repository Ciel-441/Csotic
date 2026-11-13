use rusqlite::{Connection, Result as SqlResult};
use std::path::Path;

/// Initialize the SQLite database with versioned migrations and low-memory, fast-sync PRAGMAs.
pub fn init_db(db_path: &Path) -> SqlResult<Connection> {
    let conn = Connection::open(db_path)?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA foreign_keys = ON;
         PRAGMA cache_size = -2000;
         PRAGMA temp_store = MEMORY;
         PRAGMA mmap_size = 67108864;"
    )?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> SqlResult<()> {
    let current_version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap_or(0);

    if current_version < 1 {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                root_path TEXT NOT NULL UNIQUE,
                canonical_path TEXT NOT NULL,
                name TEXT NOT NULL,
                project_type TEXT NOT NULL,
                package_manager TEXT NOT NULL,
                git_root TEXT,
                content_fingerprint TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_seen_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                active_project_id TEXT,
                state_json TEXT NOT NULL DEFAULT '{}',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS conversations (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                title TEXT NOT NULL,
                model TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS ai_tasks (
                id TEXT PRIMARY KEY,
                conversation_id TEXT,
                project_id TEXT,
                request TEXT NOT NULL,
                mode TEXT NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS task_steps (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                step_type TEXT NOT NULL,
                status TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS changesets (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                project_id TEXT,
                state TEXT NOT NULL,
                reason TEXT NOT NULL,
                created_at TEXT NOT NULL,
                applied_at TEXT,
                FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE,
                FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
            );

            CREATE TABLE IF NOT EXISTS changeset_operations (
                id TEXT PRIMARY KEY,
                changeset_id TEXT NOT NULL,
                sequence INTEGER NOT NULL,
                operation TEXT NOT NULL,
                path TEXT NOT NULL,
                source_path TEXT,
                destination_path TEXT,
                expected_hash TEXT,
                before_hash TEXT,
                after_hash TEXT,
                status TEXT NOT NULL,
                FOREIGN KEY (changeset_id) REFERENCES changesets(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS rollback_journal_entries (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                turn_idx INTEGER NOT NULL DEFAULT 0,
                sequence INTEGER NOT NULL,
                path TEXT NOT NULL,
                original_hash TEXT NOT NULL,
                original_content TEXT,
                was_newly_created INTEGER NOT NULL,
                hash_after_apply TEXT,
                source_path TEXT,
                destination_path TEXT,
                destination_before_state TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_rollback_task ON rollback_journal_entries(task_id);
            CREATE INDEX IF NOT EXISTS idx_rollback_task_turn ON rollback_journal_entries(task_id, turn_idx);

            CREATE TABLE IF NOT EXISTS file_state (
                project_id TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                content_hash TEXT NOT NULL,
                size INTEGER NOT NULL,
                mtime INTEGER NOT NULL,
                language TEXT,
                indexed_at TEXT NOT NULL,
                deleted INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (project_id, relative_path)
            );

            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                category TEXT NOT NULL,
                summary TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence REAL NOT NULL DEFAULT 0.9,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS symbols (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dependencies (
                project_id TEXT NOT NULL,
                source_file TEXT NOT NULL,
                target_file TEXT NOT NULL,
                relationship TEXT NOT NULL,
                PRIMARY KEY (project_id, source_file, target_file, relationship)
            );

            CREATE TABLE IF NOT EXISTS validation_runs (
                id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                validation_type TEXT NOT NULL,
                status TEXT NOT NULL,
                output TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES ai_tasks(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS events (
                id TEXT PRIMARY KEY,
                task_id TEXT,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS recent_projects (
                path TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                opened_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS project_index (
                project_path TEXT PRIMARY KEY,
                summary TEXT NOT NULL,
                file_count INTEGER NOT NULL DEFAULT 0,
                indexed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS api_keys (
                provider TEXT PRIMARY KEY,
                key_value TEXT NOT NULL,
                updated_at TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS app_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS graph_nodes (
                id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                properties TEXT,
                PRIMARY KEY (id, project_id)
            );

            CREATE TABLE IF NOT EXISTS graph_edges (
                source TEXT NOT NULL,
                target TEXT NOT NULL,
                relationship TEXT NOT NULL,
                project_id TEXT NOT NULL,
                PRIMARY KEY (source, target, relationship, project_id)
            );

            CREATE TABLE IF NOT EXISTS action_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                created_at TEXT NOT NULL
            );"
        )?;
        conn.execute("PRAGMA user_version = 1", [])?;
    }

    if current_version < 2 {
        let _ = conn.execute("CREATE TABLE IF NOT EXISTS graph_nodes (id TEXT NOT NULL, project_id TEXT NOT NULL, kind TEXT NOT NULL, properties TEXT, PRIMARY KEY (id, project_id))", []);
        let _ = conn.execute("CREATE TABLE IF NOT EXISTS graph_edges (source TEXT NOT NULL, target TEXT NOT NULL, relationship TEXT NOT NULL, project_id TEXT NOT NULL, PRIMARY KEY (source, target, relationship, project_id))", []);
        conn.execute("PRAGMA user_version = 2", [])?;
    }

    Ok(())
}

