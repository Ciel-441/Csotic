use rusqlite::{Connection, Result, params};
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: String, // e.g., "file:///src/main.rs" or "symbol://MyStruct"
    pub project_id: Option<String>,
    pub kind: String, // "file", "function", "class"
    pub properties: Option<String>, // JSON string
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Edge {
    pub source: String,
    pub target: String,
    pub project_id: Option<String>,
    pub relationship: String, // "imports", "calls", "defines"
}

pub fn init_graph_db(db: &std::sync::Mutex<Connection>) -> Result<()> {
    let conn = db.lock().unwrap();
    conn.execute(
        "CREATE TABLE IF NOT EXISTS graph_nodes (
            id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            properties TEXT,
            PRIMARY KEY (id, project_id)
        )",
        [],
    )?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS graph_edges (
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            relationship TEXT NOT NULL,
            project_id TEXT NOT NULL,
            PRIMARY KEY (source, target, relationship, project_id)
        )",
        [],
    )?;
    Ok(())
}

pub fn insert_node(db: &std::sync::Mutex<Connection>, node: &Node) -> Result<()> {
    let conn = db.lock().unwrap();
    let pid = node.project_id.as_deref().unwrap_or("global");
    conn.execute(
        "INSERT OR REPLACE INTO graph_nodes (id, project_id, kind, properties) VALUES (?1, ?2, ?3, ?4)",
        params![node.id, pid, node.kind, node.properties],
    )?;
    Ok(())
}

pub fn insert_edge(db: &std::sync::Mutex<Connection>, edge: &Edge) -> Result<()> {
    let conn = db.lock().unwrap();
    let pid = edge.project_id.as_deref().unwrap_or("global");
    conn.execute(
        "INSERT OR REPLACE INTO graph_edges (source, target, relationship, project_id) VALUES (?1, ?2, ?3, ?4)",
        params![edge.source, edge.target, edge.relationship, pid],
    )?;
    Ok(())
}

pub fn query_dependencies(db: &std::sync::Mutex<Connection>, id: &str, project_id: Option<&str>) -> Result<Vec<Edge>> {
    let conn = db.lock().unwrap();
    if let Some(pid) = project_id {
        let mut stmt = conn.prepare("SELECT source, target, project_id, relationship FROM graph_edges WHERE source = ?1 AND (project_id = ?2 OR project_id IS NULL)")?;
        let edges_iter = stmt.query_map(params![id, pid], |row| {
            Ok(Edge {
                source: row.get(0)?,
                target: row.get(1)?,
                project_id: row.get(2)?,
                relationship: row.get(3)?,
            })
        })?;
        let mut edges = Vec::new();
        for edge in edges_iter {
            edges.push(edge?);
        }
        Ok(edges)
    } else {
        let mut stmt = conn.prepare("SELECT source, target, project_id, relationship FROM graph_edges WHERE source = ?1")?;
        let edges_iter = stmt.query_map(params![id], |row| {
            Ok(Edge {
                source: row.get(0)?,
                target: row.get(1)?,
                project_id: row.get(2)?,
                relationship: row.get(3)?,
            })
        })?;
        let mut edges = Vec::new();
        for edge in edges_iter {
            edges.push(edge?);
        }
        Ok(edges)
    }
}

pub fn handle(action: &str, payload: &serde_json::Value, db: &std::sync::Mutex<Connection>) -> std::result::Result<serde_json::Value, String> {
    match action {
        "insert_node" => {
            let node: Node = serde_json::from_value(payload.clone()).map_err(|e| e.to_string())?;
            insert_node(db, &node).map_err(|e| e.to_string())?;
            Ok(serde_json::json!({ "success": true }))
        }
        "insert_edge" => {
            let edge: Edge = serde_json::from_value(payload.clone()).map_err(|e| e.to_string())?;
            insert_edge(db, &edge).map_err(|e| e.to_string())?;
            Ok(serde_json::json!({ "success": true }))
        }
        "query_deps" => {
            let id = payload.get("id").and_then(|v| v.as_str()).ok_or("Missing id")?;
            let project_id = payload.get("project_id").and_then(|v| v.as_str());
            let deps = query_dependencies(db, id, project_id).map_err(|e| e.to_string())?;
            serde_json::to_value(deps).map_err(|e| e.to_string())
        }
        _ => Err(format!("Unknown action: {}", action))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn test_graph_operations() {
        let conn = Connection::open_in_memory().unwrap();
        let db = Mutex::new(conn);
        init_graph_db(&db).unwrap();

        let node1 = Node {
            id: "file1.rs".to_string(),
            project_id: Some("proj_1".to_string()),
            kind: "file".to_string(),
            properties: None,
        };
        let node2 = Node {
            id: "file2.rs".to_string(),
            project_id: Some("proj_1".to_string()),
            kind: "file".to_string(),
            properties: None,
        };
        
        insert_node(&db, &node1).unwrap();
        insert_node(&db, &node2).unwrap();

        let edge = Edge {
            source: "file1.rs".to_string(),
            target: "file2.rs".to_string(),
            project_id: Some("proj_1".to_string()),
            relationship: "imports".to_string(),
        };
        
        insert_edge(&db, &edge).unwrap();

        let deps = query_dependencies(&db, "file1.rs", Some("proj_1")).unwrap();
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].target, "file2.rs");
        assert_eq!(deps[0].relationship, "imports");

        // Query with different project_id returns empty
        let deps2 = query_dependencies(&db, "file1.rs", Some("proj_2")).unwrap();
        assert_eq!(deps2.len(), 0);
    }
}
