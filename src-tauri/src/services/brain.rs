use std::fs;
use std::path::Path;
use serde::{Serialize, Deserialize};
use ignore::WalkBuilder;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainNote {
    pub filename: String,
    pub path: String,
    pub title: String,
    pub summary: String,
    pub tags: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainNode {
    pub id: String,
    pub label: String,
    pub kind: String, // "note", "code", "symbol", "config"
    pub path: String,
    pub group: String,
    pub connections: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainEdge {
    pub source: String,
    pub target: String,
    pub relationship: String, // "wikilink", "import", "contains"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainGraphData {
    pub nodes: Vec<BrainNode>,
    pub edges: Vec<BrainEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacklinkItem {
    pub source_path: String,
    pub source_name: String,
    pub line_number: usize,
    pub line_content: String,
}

/// Ensures the .forge/brain folder exists in the project and populates default starter notes if empty.
pub fn ensure_brain_vault(project_path: &str) -> std::path::PathBuf {
    let brain_dir = Path::new(project_path).join(".forge").join("brain");
    if !brain_dir.exists() {
        let _ = fs::create_dir_all(&brain_dir);
    }

    let arch_note = brain_dir.join("architecture.md");
    if !arch_note.exists() {
        let _ = fs::write(
            &arch_note,
            "# 🏛️ Project Architecture\n\n## Overview\nHigh-level architectural overview and system layers.\n\n## Core Modules\n- [[decisions.md]]: Architectural decision records\n- [[tasks.md]]: Project tasks and roadmap\n",
        );
    }

    let dec_note = brain_dir.join("decisions.md");
    if !dec_note.exists() {
        let _ = fs::write(
            &dec_note,
            "# ⚖️ Architectural Decision Records\n\n## ADR-001: Project Foundation\n- **Status**: Accepted\n- **Context**: Setting up workspace architecture and standards.\n- **Decision**: Adopt modern modular engineering patterns.\n",
        );
    }

    let task_note = brain_dir.join("tasks.md");
    if !task_note.exists() {
        let _ = fs::write(
            &task_note,
            "# 📋 Tasks & Dev Log\n\n- [x] Initial project setup\n- [ ] Implement core features\n- [ ] Add comprehensive test suite\n",
        );
    }

    brain_dir
}

/// Lists all notes in the project's .forge/brain vault.
pub fn list_notes(project_path: &str) -> Vec<BrainNote> {
    let brain_dir = ensure_brain_vault(project_path);
    let mut notes = Vec::new();

    if let Ok(entries) = fs::read_dir(brain_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("md") {
                let filename = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                let content = fs::read_to_string(&path).unwrap_or_default();
                
                // Extract title (first # Heading or filename)
                let mut title = filename.replace(".md", "");
                let mut summary = String::new();
                let mut tags = Vec::new();

                for line in content.lines() {
                    let trimmed = line.trim();
                    if trimmed.starts_with("# ") && title == filename.replace(".md", "") {
                        title = trimmed.trim_start_matches("# ").trim().to_string();
                    } else if !trimmed.is_empty() && summary.is_empty() && !trimmed.starts_with('#') {
                        summary = trimmed.chars().take(120).collect();
                    }

                    // Extract tags like #arch, #todo, #v1
                    for word in trimmed.split_whitespace() {
                        if word.starts_with('#') && word.len() > 1 && !word.starts_with("##") {
                            let tag = word.trim_matches(|c: char| !c.is_alphanumeric()).to_string();
                            if !tag.is_empty() && !tags.contains(&tag) {
                                tags.push(tag);
                            }
                        }
                    }
                }

                let updated_at = entry.metadata()
                    .and_then(|m| m.modified())
                    .map(|t| {
                        let duration = t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
                        chrono::DateTime::from_timestamp(duration.as_secs() as i64, 0)
                            .map(|d| d.format("%Y-%m-%d %H:%M").to_string())
                            .unwrap_or_else(|| "Recent".to_string())
                    })
                    .unwrap_or_else(|_| "Recent".to_string());

                notes.push(BrainNote {
                    filename,
                    path: path.to_string_lossy().to_string(),
                    title,
                    summary,
                    tags,
                    updated_at,
                });
            }
        }
    }

    notes.sort_by(|a, b| a.title.cmp(&b.title));
    notes
}

/// Creates a new note in the project brain vault.
pub fn create_note(project_path: &str, title: &str, content: Option<&str>) -> Result<BrainNote, String> {
    let brain_dir = ensure_brain_vault(project_path);
    let slug = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect::<String>();
    
    let filename = if slug.ends_with(".md") { slug } else { format!("{slug}.md") };
    let file_path = brain_dir.join(&filename);

    if file_path.exists() {
        return Err(format!("Note `{}` already exists in brain vault.", filename));
    }

    let default_content = format!("# {}\n\nCreated: {}\n\n", title, chrono::Local::now().format("%Y-%m-%d %H:%M"));
    let body = content.unwrap_or(&default_content);

    fs::write(&file_path, body).map_err(|e| format!("Failed to create note: {e}"))?;

    Ok(BrainNote {
        filename,
        path: file_path.to_string_lossy().to_string(),
        title: title.to_string(),
        summary: String::new(),
        tags: Vec::new(),
        updated_at: "Just now".to_string(),
    })
}

/// Builds the comprehensive 2D Knowledge & Code Graph.
pub fn get_graph_data(project_path: &str) -> BrainGraphData {
    ensure_brain_vault(project_path);

    let mut nodes: Vec<BrainNode> = Vec::new();
    let mut edges: Vec<BrainEdge> = Vec::new();
    let mut node_set = std::collections::HashSet::new();

    // 1. Traverse Workspace Files
    let walker = WalkBuilder::new(project_path)
        .hidden(false)
        .git_ignore(true)
        .build();

    let mut file_contents: Vec<(String, String, String)> = Vec::new(); // (id, rel_path, content)

    for result in walker.flatten() {
        let path = result.path();
        if path.is_file() {
            let path_str = path.to_string_lossy().to_string();
            // Filter noise, build directories, hidden caches, and benchmark dumps
            if path_str.contains(".git") || path_str.contains("node_modules") 
                || path_str.contains("target") || path_str.contains("dist") 
                || path_str.contains(".cargo") || path_str.contains("coverage") 
                || path_str.contains("__pycache__") || path_str.contains(".idea") {
                continue;
            }

            let rel_path = path.strip_prefix(project_path)
                .unwrap_or(path)
                .to_string_lossy()
                .replace('\\', "/");

            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
            let is_brain_note = path_str.contains(".forge") && path_str.contains("brain");
            let file_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();

            // Skip excessive raw benchmark or temporary generated files
            if file_name.starts_with("bench_") || file_name.starts_with('.') {
                if !is_brain_note {
                    continue;
                }
            }

            let kind = if is_brain_note {
                "note"
            } else if matches!(ext, "rs" | "ts" | "tsx" | "js" | "jsx" | "c" | "cpp" | "h" | "py" | "go" | "salivo") {
                "code"
            } else if matches!(ext, "json" | "toml" | "yaml" | "yml" | "lock") {
                "config"
            } else if ext == "md" {
                "doc"
            } else {
                continue;
            };

            // Extract directory group
            let dir_parts: Vec<&str> = rel_path.split('/').collect();
            let group = if is_brain_note {
                "Brain Vault".to_string()
            } else if dir_parts.len() > 1 {
                dir_parts[..dir_parts.len().saturating_sub(1)].join("/")
            } else {
                "Root".to_string()
            };

            let label = file_name;
            let node_id = rel_path.clone();

            if !node_set.contains(&node_id) && nodes.len() < 160 {
                node_set.insert(node_id.clone());
                nodes.push(BrainNode {
                    id: node_id.clone(),
                    label,
                    kind: kind.to_string(),
                    path: path_str.clone(),
                    group,
                    connections: 0,
                });

                if let Ok(content) = fs::read_to_string(path) {
                    if content.len() < 250_000 {
                        file_contents.push((node_id, rel_path, content));
                    }
                }
            }
        }
    }

    // 2. Extract Edges (Wikilinks `[[...]]` and File Imports)
    let mut connection_counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut edge_set: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();

    for (source_id, _, content) in &file_contents {
        // (A) Extract Wikilinks [[target]]
        let mut idx = 0;
        while let Some(start) = content[idx..].find("[[") {
            let actual_start = idx + start + 2;
            if let Some(end) = content[actual_start..].find("]]") {
                let link_target = content[actual_start..actual_start + end].trim();
                let clean_target = link_target.split('|').next().unwrap_or(link_target).trim();
                
                // Match against existing nodes
                for node in &nodes {
                    let target_stem = node.label.trim_end_matches(".md");
                    if node.label.eq_ignore_ascii_case(clean_target) 
                        || target_stem.eq_ignore_ascii_case(clean_target)
                        || node.id.eq_ignore_ascii_case(clean_target) {
                        if node.id != *source_id {
                            let key = if source_id < &node.id { (source_id.clone(), node.id.clone()) } else { (node.id.clone(), source_id.clone()) };
                            if !edge_set.contains(&key) {
                                edge_set.insert(key);
                                edges.push(BrainEdge {
                                    source: source_id.clone(),
                                    target: node.id.clone(),
                                    relationship: "wikilink".to_string(),
                                });
                                *connection_counts.entry(source_id.clone()).or_insert(0) += 1;
                                *connection_counts.entry(node.id.clone()).or_insert(0) += 1;
                            }
                        }
                        break;
                    }
                }
                idx = actual_start + end + 2;
            } else {
                break;
            }
        }

        // (B) Extract Imports (e.g. from './Sidebar', use crate::..., #include "...")
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("import ") || trimmed.starts_with("use ") || trimmed.starts_with("#include ") || trimmed.starts_with("require(") {
                for node in &nodes {
                    if node.id != *source_id {
                        let stem = node.label.split('.').next().unwrap_or(&node.label);
                        // Require stem to be at least 3 chars or exact file name to avoid matching single letters like 'a' or 'i'
                        let label = &node.label;
                        let is_match = if stem.len() >= 3 {
                            // Check for path or quoted import match: e.g. "./BrainSidebarPanel" or "services::agent"
                            trimmed.contains(label) 
                                || trimmed.contains(&format!("\"{stem}")) 
                                || trimmed.contains(&format!("\'{stem}")) 
                                || trimmed.contains(&format!("/{stem}")) 
                                || trimmed.contains(&format!("::{stem}"))
                        } else {
                            trimmed.contains(&format!("\"{label}\"")) || trimmed.contains(&format!("\'{label}\'"))
                        };

                        if is_match {
                            let key = if source_id < &node.id { (source_id.clone(), node.id.clone()) } else { (node.id.clone(), source_id.clone()) };
                            if !edge_set.contains(&key) {
                                edge_set.insert(key);
                                edges.push(BrainEdge {
                                    source: source_id.clone(),
                                    target: node.id.clone(),
                                    relationship: "import".to_string(),
                                });
                                *connection_counts.entry(source_id.clone()).or_insert(0) += 1;
                                *connection_counts.entry(node.id.clone()).or_insert(0) += 1;
                            }
                            break;
                        }
                    }
                }
            }
        }
    }

    // Update connection count on nodes
    for node in &mut nodes {
        node.connections = *connection_counts.get(&node.id).unwrap_or(&0);
    }

    BrainGraphData { nodes, edges }
}

/// Finds all files and notes that reference a target file or note.
pub fn get_backlinks(project_path: &str, target_path: &str) -> Vec<BacklinkItem> {
    let mut backlinks = Vec::new();
    let target_name = Path::new(target_path).file_name().unwrap_or_default().to_string_lossy().to_string();
    let target_stem = target_name.trim_end_matches(".md");

    let walker = WalkBuilder::new(project_path)
        .hidden(false)
        .git_ignore(true)
        .build();

    for result in walker.flatten() {
        let path = result.path();
        if path.is_file() {
            let path_str = path.to_string_lossy().to_string();
            if path_str.contains(".git") || path_str.contains("node_modules") 
                || path_str.contains("target") || path_str.contains("dist") || path_str == target_path {
                continue;
            }

            if let Ok(content) = fs::read_to_string(path) {
                for (idx, line) in content.lines().enumerate() {
                    let trimmed = line.trim();
                    if trimmed.contains(&format!("[[{}]]", target_name)) 
                        || trimmed.contains(&format!("[[{}]]", target_stem))
                        || (trimmed.contains(&target_name) && (trimmed.starts_with("import ") || trimmed.starts_with("use ") || trimmed.starts_with("#include "))) {
                        backlinks.push(BacklinkItem {
                            source_path: path_str.clone(),
                            source_name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
                            line_number: idx + 1,
                            line_content: trimmed.to_string(),
                        });
                        if backlinks.len() >= 50 {
                            break;
                        }
                    }
                }
            }
        }
    }

    backlinks
}

/// Handles IPC requests for the "brain" service.
pub fn handle(action: &str, payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    match action {
        "list_notes" => {
            let project_path = payload.get("project_path").and_then(|v| v.as_str())
                .ok_or("Missing 'project_path'")?;
            let notes = list_notes(project_path);
            serde_json::to_value(notes).map_err(|e| e.to_string())
        }
        "create_note" => {
            let project_path = payload.get("project_path").and_then(|v| v.as_str())
                .ok_or("Missing 'project_path'")?;
            let title = payload.get("title").and_then(|v| v.as_str())
                .ok_or("Missing 'title'")?;
            let content = payload.get("content").and_then(|v| v.as_str());
            let note = create_note(project_path, title, content)?;
            serde_json::to_value(note).map_err(|e| e.to_string())
        }
        "save_note" => {
            let path_str = payload.get("path").and_then(|v| v.as_str())
                .ok_or("Missing 'path'")?;
            let content = payload.get("content").and_then(|v| v.as_str())
                .ok_or("Missing 'content'")?;
            fs::write(path_str, content).map_err(|e| format!("Failed to save note: {e}"))?;
            Ok(serde_json::json!({ "saved": true }))
        }
        "delete_note" => {
            let path_str = payload.get("path").and_then(|v| v.as_str())
                .ok_or("Missing 'path'")?;
            if Path::new(path_str).exists() {
                fs::remove_file(path_str).map_err(|e| format!("Failed to delete note: {e}"))?;
            }
            Ok(serde_json::json!({ "deleted": true }))
        }
        "get_graph" => {
            let project_path = payload.get("project_path").and_then(|v| v.as_str())
                .ok_or("Missing 'project_path'")?;
            let graph_data = get_graph_data(project_path);
            serde_json::to_value(graph_data).map_err(|e| e.to_string())
        }
        "get_backlinks" => {
            let project_path = payload.get("project_path").and_then(|v| v.as_str())
                .ok_or("Missing 'project_path'")?;
            let target_path = payload.get("target_path").and_then(|v| v.as_str())
                .ok_or("Missing 'target_path'")?;
            let backlinks = get_backlinks(project_path, target_path);
            serde_json::to_value(backlinks).map_err(|e| e.to_string())
        }
        _ => Err(format!("Unknown brain action: {action}")),
    }
}
