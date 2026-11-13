use rusqlite::Connection;
use std::sync::Mutex;

pub fn handle(action: &str, payload: &serde_json::Value, db: &Mutex<Connection>) -> Result<serde_json::Value, String> {
    match action {
        "add_memory" => {
            let project_id = payload.get("project_id").and_then(|v| v.as_str()).map(|s| s.to_string());
            let category = payload.get("category").and_then(|v| v.as_str()).ok_or("Missing 'category'")?;
            let summary = payload.get("summary").and_then(|v| v.as_str()).ok_or("Missing 'summary'")?;
            let source = payload.get("source").and_then(|v| v.as_str()).ok_or("Missing 'source'")?;
            let confidence = payload.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.9);
            let id = uuid::Uuid::new_v4().to_string();
            let now = chrono::Utc::now().to_rfc3339();

            let conn = db.lock().map_err(|e| format!("DB lock error: {e}"))?;
            conn.execute(
                "INSERT INTO memories (id, project_id, category, summary, source, confidence, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                rusqlite::params![id, project_id, category, summary, source, confidence, now],
            ).map_err(|e| format!("DB insert error: {e}"))?;

            Ok(serde_json::json!({ "id": id }))
        }
        "get_memories" => {
            let category = payload.get("category").and_then(|v| v.as_str());
            let project_id = payload.get("project_id").and_then(|v| v.as_str());
            let conn = db.lock().map_err(|e| format!("DB lock error: {e}"))?;

            let mut memories = Vec::new();
            if let Some(cat) = category {
                if let Some(pid) = project_id {
                    let mut stmt = conn.prepare("SELECT id, category, summary, source, confidence, created_at, project_id FROM memories WHERE category = ?1 AND (project_id = ?2 OR project_id IS NULL) ORDER BY created_at DESC")
                        .map_err(|e| format!("DB error: {e}"))?;
                    let rows = stmt.query_map([cat, pid], |row| {
                        Ok(serde_json::json!({
                            "id": row.get::<_, String>(0)?,
                            "category": row.get::<_, String>(1)?,
                            "summary": row.get::<_, String>(2)?,
                            "source": row.get::<_, String>(3)?,
                            "confidence": row.get::<_, f64>(4)?,
                            "created_at": row.get::<_, String>(5)?,
                            "project_id": row.get::<_, Option<String>>(6)?,
                        }))
                    }).map_err(|e| format!("DB error: {e}"))?;
                    for row in rows.flatten() { memories.push(row); }
                } else {
                    let mut stmt = conn.prepare("SELECT id, category, summary, source, confidence, created_at, project_id FROM memories WHERE category = ?1 ORDER BY created_at DESC")
                        .map_err(|e| format!("DB error: {e}"))?;
                    let rows = stmt.query_map([cat], |row| {
                        Ok(serde_json::json!({
                            "id": row.get::<_, String>(0)?,
                            "category": row.get::<_, String>(1)?,
                            "summary": row.get::<_, String>(2)?,
                            "source": row.get::<_, String>(3)?,
                            "confidence": row.get::<_, f64>(4)?,
                            "created_at": row.get::<_, String>(5)?,
                            "project_id": row.get::<_, Option<String>>(6)?,
                        }))
                    }).map_err(|e| format!("DB error: {e}"))?;
                    for row in rows.flatten() { memories.push(row); }
                }
            } else {
                if let Some(pid) = project_id {
                    let mut stmt = conn.prepare("SELECT id, category, summary, source, confidence, created_at, project_id FROM memories WHERE project_id = ?1 OR project_id IS NULL ORDER BY created_at DESC")
                        .map_err(|e| format!("DB error: {e}"))?;
                    let rows = stmt.query_map([pid], |row| {
                        Ok(serde_json::json!({
                            "id": row.get::<_, String>(0)?,
                            "category": row.get::<_, String>(1)?,
                            "summary": row.get::<_, String>(2)?,
                            "source": row.get::<_, String>(3)?,
                            "confidence": row.get::<_, f64>(4)?,
                            "created_at": row.get::<_, String>(5)?,
                            "project_id": row.get::<_, Option<String>>(6)?,
                        }))
                    }).map_err(|e| format!("DB error: {e}"))?;
                    for row in rows.flatten() { memories.push(row); }
                } else {
                    let mut stmt = conn.prepare("SELECT id, category, summary, source, confidence, created_at, project_id FROM memories ORDER BY created_at DESC")
                        .map_err(|e| format!("DB error: {e}"))?;
                    let rows = stmt.query_map([], |row| {
                        Ok(serde_json::json!({
                            "id": row.get::<_, String>(0)?,
                            "category": row.get::<_, String>(1)?,
                            "summary": row.get::<_, String>(2)?,
                            "source": row.get::<_, String>(3)?,
                            "confidence": row.get::<_, f64>(4)?,
                            "created_at": row.get::<_, String>(5)?,
                            "project_id": row.get::<_, Option<String>>(6)?,
                        }))
                    }).map_err(|e| format!("DB error: {e}"))?;
                    for row in rows.flatten() { memories.push(row); }
                }
            }
            // Frontend expects bare array: Array.isArray(res.data)
            Ok(serde_json::Value::Array(memories))
        }
        "delete_memory" => {
            let id = payload.get("id").and_then(|v| v.as_str()).ok_or("Missing 'id'")?;
            let conn = db.lock().map_err(|e| format!("DB lock error: {e}"))?;
            conn.execute("DELETE FROM memories WHERE id = ?1", [id])
                .map_err(|e| format!("DB error: {e}"))?;
            Ok(serde_json::json!({ "deleted": true }))
        }
        _ => Err(format!("Unknown memory action: {action}")),
    }
}

pub fn get_all_memories_summary(db: &Mutex<Connection>, project_id: Option<&str>, objective: &str) -> String {
    let Ok(conn) = db.lock() else { return String::new(); };

    let mut rows_data = Vec::new();

    if let Some(pid) = project_id {
        if let Ok(mut stmt) = conn.prepare("SELECT category, summary FROM memories WHERE project_id = ?1 OR project_id IS NULL") {
            if let Ok(rows) = stmt.query_map([pid], |row| {
                let cat: String = row.get(0)?;
                let sum: String = row.get(1)?;
                Ok((cat, sum))
            }) {
                for r in rows.flatten() {
                    rows_data.push(r);
                }
            }
        }
    } else {
        if let Ok(mut stmt) = conn.prepare("SELECT category, summary FROM memories WHERE project_id IS NULL") {
            if let Ok(rows) = stmt.query_map([], |row| {
                let cat: String = row.get(0)?;
                let sum: String = row.get(1)?;
                Ok((cat, sum))
            }) {
                for r in rows.flatten() {
                    rows_data.push(r);
                }
            }
        }
    }

    if rows_data.is_empty() {
        return String::new();
    }

    let keywords: Vec<String> = objective
        .to_lowercase()
        .split_whitespace()
        .filter(|w| w.len() > 2)
        .map(|w| w.to_string())
        .collect();

    let mut scored: Vec<(usize, String)> = Vec::new();
    for (cat, sum) in rows_data {
        let combined = format!("{} {}", cat, sum).to_lowercase();
        let score = keywords.iter().filter(|k| combined.contains(*k)).count();
        scored.push((score, format!("- [{cat}]: {sum}")));
    }

    // Sort by keyword overlap score DESC
    scored.sort_by_key(|b| std::cmp::Reverse(b.0));

    let top_memories: Vec<String> = scored.into_iter().take(5).map(|(_, s)| s).collect();

    if top_memories.is_empty() {
        String::new()
    } else {
        format!("\n\n[Persistent Project Memory & Conventions]\n{}", top_memories.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::Mutex;

    #[test]
    fn test_scoped_memories_summary() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE memories (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                category TEXT NOT NULL,
                summary TEXT NOT NULL,
                source TEXT NOT NULL,
                confidence REAL NOT NULL,
                created_at TEXT NOT NULL
            )",
            [],
        ).unwrap();

        let db = Mutex::new(conn);

        // Insert memory for Project A
        let _ = handle("add_memory", &serde_json::json!({
            "project_id": "proj_a",
            "category": "Convention",
            "summary": "Always use Tailwind utility classes in Project A",
            "source": "manual",
        }), &db);

        // Insert memory for Project B
        let _ = handle("add_memory", &serde_json::json!({
            "project_id": "proj_b",
            "category": "Convention",
            "summary": "Always use Styled Components in Project B",
            "source": "manual",
        }), &db);

        // Query summary for Project A
        let summary_a = get_all_memories_summary(&db, Some("proj_a"), "Tailwind classes");
        assert!(summary_a.contains("Tailwind"));
        assert!(!summary_a.contains("Styled Components"));

        // Query summary for Project B
        let summary_b = get_all_memories_summary(&db, Some("proj_b"), "Styled Components");
        assert!(summary_b.contains("Styled Components"));
        assert!(!summary_b.contains("Tailwind"));
    }
}
