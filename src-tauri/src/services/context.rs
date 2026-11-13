use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ContextScore {
    pub file_path: String,
    pub score: i32,
    pub reasons: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ExistingCapability {
    pub domain: String,
    pub primary_files: Vec<String>,
    pub key_symbols: Vec<String>,
    pub recommendation: String,
}

#[derive(Debug, Clone)]
pub struct ContextSynthesis {
    pub ranked_files: Vec<ContextScore>,
    pub git_diff: String,
    pub memory_summary: String,
    pub brain_context: String,
    pub graph_context: String,
    pub predictive_warnings: String,
    pub security_warnings: String,
    pub runtime_warnings: String,
    pub performance_warnings: String,
    pub refactoring_warnings: String,
    pub plugin_warnings: String,
}

pub struct ContextEngine;

impl ContextEngine {
    pub fn synthesize_context(
        project_path: &str,
        objective: &str,
        active_files: &[String],
        db: &Mutex<Connection>,
    ) -> ContextSynthesis {
        let project_id = crate::services::filesystem::compute_project_id(project_path);
        let ranked = Self::rank_context(project_path, objective, active_files, db, &project_id);

        let mut git_cmd = std::process::Command::new("git");
        git_cmd.args(["diff", "--stat"]).current_dir(project_path);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            git_cmd.creation_flags(0x08000000);
        }

        let git_diff = git_cmd
            .output()
            .map(|o| {
                let diff = String::from_utf8_lossy(&o.stdout).to_string();
                if diff.len() > 2000 {
                    format!("{}...\n[Diff truncated]", &diff[..2000])
                } else {
                    diff
                }
            })
            .unwrap_or_default();

        let memory_summary =
            crate::services::memory::get_all_memories_summary(db, Some(&project_id), objective);

        // Load project Obsidian brain vault notes (.forge/brain/*.md) - ranked by semantic relevance + source linkage
        let mut brain_context = String::new();
        let brain_dir = std::path::Path::new(project_path)
            .join(".forge")
            .join("brain");
        if brain_dir.is_dir() {
            if let Ok(entries) = std::fs::read_dir(brain_dir) {
                let mut note_scores: Vec<(usize, String, String)> = Vec::new();
                let semantic_terms = Self::expand_semantic_concepts(objective);

                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) == Some("md") {
                        if let Ok(content) = std::fs::read_to_string(&path) {
                            let file_name = path
                                .file_name()
                                .unwrap_or_default()
                                .to_string_lossy()
                                .to_string();
                            let combined = format!("{} {}", file_name, content).to_lowercase();
                            let mut score = semantic_terms
                                .iter()
                                .filter(|k| combined.contains(*k))
                                .count()
                                * 10;

                            // Durable Source Linkage: Verify referenced source files exist in active workspace
                            let mut source_status = Vec::new();
                            let mut has_stale = false;

                            // Check words that look like file paths (e.g. src/..., AuthProvider.tsx, etc.)
                            for token in content.split_whitespace() {
                                let clean_token = token.trim_matches(|c| {
                                    c == '`'
                                        || c == '('
                                        || c == ')'
                                        || c == '['
                                        || c == ']'
                                        || c == '\''
                                        || c == '"'
                                });
                                if (clean_token.starts_with("src/") || clean_token.contains('.'))
                                    && (clean_token.ends_with(".ts")
                                        || clean_token.ends_with(".tsx")
                                        || clean_token.ends_with(".rs")
                                        || clean_token.ends_with(".js")
                                        || clean_token.ends_with(".jsx")
                                        || clean_token.ends_with(".py"))
                                {
                                    let candidate_file =
                                        std::path::Path::new(project_path).join(clean_token);
                                    if candidate_file.is_file() {
                                        source_status.push(format!("Linked: {}", clean_token));
                                    } else {
                                        has_stale = true;
                                        source_status
                                            .push(format!("STALE/MISSING: {}", clean_token));
                                    }
                                }
                            }

                            let linkage_tag = if has_stale {
                                score = score.saturating_sub(15);
                                format!(
                                    "[⚠️ NOTE CONTAINS STALE SOURCE REFERENCES: {}]\n",
                                    source_status.join(", ")
                                )
                            } else if !source_status.is_empty() {
                                score += 20;
                                format!(
                                    "[✅ VERIFIED LIVE SOURCE REFERENCES: {}]\n",
                                    source_status.join(", ")
                                )
                            } else {
                                String::new()
                            };

                            let preview = if content.len() > 1500 {
                                format!("{}{}\n[Note truncated]", linkage_tag, &content[..1500])
                            } else {
                                format!("{}{}", linkage_tag, content)
                            };
                            note_scores.push((score, file_name, preview));
                        }
                    }
                }

                note_scores.sort_by_key(|b| std::cmp::Reverse(b.0));
                for (_score, file_name, preview) in note_scores.into_iter().take(5) {
                    brain_context.push_str(&format!("\n### {}\n{}\n", file_name, preview.trim()));
                }
            }
        }

        let mut graph_info = String::new();
        for file in active_files {
            if let Ok(deps) =
                crate::services::graph::query_dependencies(db, file, Some(&project_id))
            {
                if !deps.is_empty() {
                    graph_info.push_str(&format!("\nDependencies for {}:\n", file));
                    for dep in deps {
                        graph_info
                            .push_str(&format!("  - {} -> {}\n", dep.relationship, dep.target));
                    }
                }
            }
        }
        if graph_info.len() > 3000 {
            graph_info = format!(
                "{}...\n[Graph dependencies truncated to fit token budget]",
                &graph_info[..3000]
            );
        }

        let predictive_warnings =
            crate::services::predictive::analyze_codebase(db, active_files, project_path);
        let security_warnings =
            crate::services::security::scan_codebase(active_files, project_path);
        let runtime_warnings = crate::services::runtime::get_runtime_warnings().join("\n- ");
        let performance_warnings =
            crate::services::performance::analyze_performance(active_files, project_path)
                .join("\n- ");
        let refactoring_warnings =
            crate::services::refactoring::analyze_refactoring(active_files, project_path)
                .join("\n- ");

        // Phase 15: Run Plugin SDK Analyzers
        let plugin_warnings = if let Ok(reg) = crate::services::plugins::REGISTRY.read() {
            reg.run_analyzers(project_path).join("\n- ")
        } else {
            String::new()
        };

        ContextSynthesis {
            ranked_files: ranked,
            git_diff,
            memory_summary,
            brain_context,
            graph_context: graph_info,
            predictive_warnings,
            security_warnings,
            runtime_warnings,
            performance_warnings,
            refactoring_warnings,
            plugin_warnings,
        }
    }

    /// Expands technical query terms into semantic concepts, synonyms, and architectural clusters
    pub fn expand_semantic_concepts(query: &str) -> Vec<String> {
        let lower = query.to_lowercase();
        let mut concepts = std::collections::HashSet::new();

        // Base alphanumeric tokens
        for word in lower.split(|c: char| !c.is_alphanumeric()) {
            if word.len() >= 3 {
                concepts.insert(word.to_string());
            }
        }

        let clusters: &[(&[&str], &[&str])] = &[
            // Auth, Session, Identity & Persistence
            (
                &[
                    "auth",
                    "authentication",
                    "login",
                    "signin",
                    "signup",
                    "register",
                    "session",
                    "user",
                    "jwt",
                    "oauth",
                    "credential",
                    "security",
                    "permission",
                    "role",
                    "identity",
                    "persistent",
                    "persistence",
                    "cookie",
                    "localstorage",
                    "rememberme",
                    "token",
                    "passkey",
                ],
                &[
                    "auth",
                    "authentication",
                    "login",
                    "session",
                    "user",
                    "jwt",
                    "token",
                    "credential",
                    "guard",
                    "security",
                    "context",
                    "provider",
                    "middleware",
                    "identity",
                    "store",
                    "persist",
                    "persistence",
                    "storage",
                    "cookie",
                    "localstorage",
                    "authstore",
                    "sessionprovider",
                    "identityservice",
                    "refreshtoken",
                ],
            ),
            // State Management & Data Flow
            (
                &[
                    "state",
                    "store",
                    "management",
                    "redux",
                    "zustand",
                    "context",
                    "flux",
                    "atom",
                    "reducer",
                    "signals",
                    "observable",
                    "cache",
                    "persistence",
                    "hydration",
                ],
                &[
                    "state",
                    "store",
                    "context",
                    "reducer",
                    "action",
                    "hook",
                    "use",
                    "atom",
                    "dispatch",
                    "provider",
                    "viewmodel",
                    "cache",
                    "persist",
                    "hydration",
                ],
            ),
            // Database, Models & Storage
            (
                &[
                    "db",
                    "database",
                    "sql",
                    "sqlite",
                    "postgres",
                    "mysql",
                    "model",
                    "schema",
                    "table",
                    "entity",
                    "orm",
                    "migration",
                    "storage",
                    "cache",
                    "redis",
                    "persist",
                    "repository",
                    "dao",
                ],
                &[
                    "db",
                    "database",
                    "sql",
                    "sqlite",
                    "query",
                    "schema",
                    "table",
                    "migration",
                    "model",
                    "repository",
                    "dao",
                    "entity",
                    "store",
                    "storage",
                    "persist",
                ],
            ),
            // API, Networking & Transport
            (
                &[
                    "api",
                    "endpoint",
                    "backend",
                    "route",
                    "http",
                    "fetch",
                    "axios",
                    "handler",
                    "controller",
                    "service",
                    "rest",
                    "rpc",
                    "ipc",
                    "client",
                    "transport",
                ],
                &[
                    "api",
                    "endpoint",
                    "route",
                    "handler",
                    "controller",
                    "service",
                    "client",
                    "request",
                    "response",
                    "fetch",
                    "rpc",
                    "ipc",
                    "transport",
                    "axios",
                ],
            ),
            // UI & Views
            (
                &[
                    "ui",
                    "view",
                    "component",
                    "widget",
                    "screen",
                    "page",
                    "modal",
                    "dialog",
                    "drawer",
                    "button",
                    "layout",
                    "theme",
                    "style",
                    "css",
                    "tailwind",
                ],
                &[
                    "component",
                    "view",
                    "page",
                    "screen",
                    "widget",
                    "modal",
                    "dialog",
                    "layout",
                    "panel",
                    "sidebar",
                    "button",
                    "theme",
                    "style",
                ],
            ),
            // Navigation & Routing
            (
                &[
                    "router",
                    "routing",
                    "route",
                    "nav",
                    "navigation",
                    "link",
                    "page",
                    "path",
                ],
                &[
                    "router",
                    "route",
                    "navigation",
                    "nav",
                    "page",
                    "link",
                    "param",
                ],
            ),
            // Testing
            (
                &[
                    "test",
                    "spec",
                    "mock",
                    "unit",
                    "e2e",
                    "integration",
                    "assert",
                ],
                &["test", "spec", "mock", "stub", "fixture", "suite"],
            ),
        ];

        for (triggers, expansions) in clusters {
            if triggers.iter().any(|t| lower.contains(t)) {
                for exp in *expansions {
                    concepts.insert(exp.to_string());
                }
            }
        }

        concepts.into_iter().collect()
    }

    /// Ranks files in a project based on multi-signal intelligence:
    /// - User open/active files (+100)
    /// - Semantic symbol discovery (+60)
    /// - Semantic path & cluster match (+50)
    /// - Multi-Hop Dependency & Topology Expansion (+35 for 1-hop, +20 for 2-hop)
    pub fn rank_context(
        project_path: &str,
        objective: &str,
        active_files: &[String],
        db: &Mutex<Connection>,
        project_id: &str,
    ) -> Vec<ContextScore> {
        let mut scores: HashMap<String, ContextScore> = HashMap::new();

        let add_score =
            |scores: &mut HashMap<String, ContextScore>, path: &str, points: i32, reason: &str| {
                let entry = scores
                    .entry(path.to_string())
                    .or_insert_with(|| ContextScore {
                        file_path: path.to_string(),
                        score: 0,
                        reasons: Vec::new(),
                    });
                entry.score += points;
                entry.reasons.push(reason.to_string());
            };

        // 1. Base heuristic: active open files are highly relevant
        for active in active_files {
            add_score(
                &mut scores,
                active,
                100,
                "User currently has this file open",
            );
        }

        // 2. Semantic Concept Expansion for Deep Search
        let semantic_terms = Self::expand_semantic_concepts(objective);

        if let Ok(conn) = db.lock() {
            for term in &semantic_terms {
                let pattern = format!("%{}%", term);
                if let Ok(mut stmt) = conn.prepare("SELECT file_path, name, kind FROM symbols WHERE project_id = ?1 AND name LIKE ?2 LIMIT 15") {
                    if let Ok(rows) = stmt.query_map(rusqlite::params![project_id, pattern], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
                    }) {
                        for r in rows.flatten() {
                            let (file_path, sym_name, kind) = r;
                            add_score(&mut scores, &file_path, 60, &format!("Semantic match: {} '{}' aligns with objective concept '{}'", kind, sym_name, term));
                        }
                    }
                }
            }
        }

        // 3. Direct dependency signals from active files
        for active in active_files {
            if let Ok(deps) =
                crate::services::graph::query_dependencies(db, active, Some(project_id))
            {
                for dep in deps {
                    add_score(
                        &mut scores,
                        &dep.target,
                        40,
                        &format!("Connected to active file via '{}'", dep.relationship),
                    );
                }
            }
        }

        // 4. Semantic path & file stem matching across repository files
        let walker = ignore::WalkBuilder::new(project_path)
            .hidden(false)
            .git_ignore(true)
            .build();

        for result in walker.flatten() {
            if result.path().is_file() {
                let rel_path = result
                    .path()
                    .strip_prefix(project_path)
                    .unwrap_or(result.path())
                    .to_string_lossy()
                    .replace("\\", "/");

                // Skip binaries and large node_modules
                if rel_path.contains("node_modules")
                    || rel_path.contains(".git")
                    || rel_path.contains("target")
                {
                    continue;
                }

                let lower_rel = rel_path.to_lowercase();
                let file_name = result
                    .path()
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase();
                let stem = result
                    .path()
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase();

                let mut matched_concepts = Vec::new();
                for term in &semantic_terms {
                    if lower_rel.contains(term)
                        || file_name.contains(term)
                        || (!stem.is_empty() && stem.contains(term))
                    {
                        matched_concepts.push(term.as_str());
                    }
                }

                if !matched_concepts.is_empty() {
                    let points = (matched_concepts.len() * 25).min(75) as i32;
                    add_score(
                        &mut scores,
                        &rel_path,
                        points,
                        &format!(
                            "Path matches semantic concepts [{}]",
                            matched_concepts.join(", ")
                        ),
                    );
                }
            }
        }

        // 5. Multi-Hop Dependency & Topology Expansion
        let initial_candidates: Vec<(String, i32)> = scores
            .iter()
            .map(|(p, cs)| (p.clone(), cs.score))
            .filter(|(_, s)| *s >= 40)
            .collect();

        for (candidate, _base_score) in &initial_candidates {
            if let Ok(deps) =
                crate::services::graph::query_dependencies(db, candidate, Some(project_id))
            {
                for dep in deps {
                    let target = dep.target.clone();
                    if &target != candidate {
                        add_score(
                            &mut scores,
                            &target,
                            35,
                            &format!(
                                "Reachable via 1-hop dependency from '{}' ({})",
                                candidate, dep.relationship
                            ),
                        );

                        // 2-hop traversal
                        if let Ok(deps_hop2) = crate::services::graph::query_dependencies(
                            db,
                            &target,
                            Some(project_id),
                        ) {
                            for dep2 in deps_hop2 {
                                if &dep2.target != candidate && dep2.target != target {
                                    add_score(
                                        &mut scores,
                                        &dep2.target,
                                        20,
                                        &format!(
                                            "Reachable via 2-hop dependency from '{}' -> '{}' ({})",
                                            candidate, target, dep2.relationship
                                        ),
                                    );
                                }
                            }
                        }
                    }
                }
            }
        }

        // Convert map to sorted vec
        let mut ranked: Vec<ContextScore> = scores.into_values().collect();
        ranked.sort_by_key(|b| std::cmp::Reverse(b.score));

        // Return top 15 most relevant files
        ranked.into_iter().take(15).collect()
    }

    /// Inspects the codebase to detect if the requested feature/domain capability already exists.
    pub fn detect_existing_capability(
        project_path: &str,
        objective: &str,
        db: &Mutex<Connection>,
        project_id: &str,
    ) -> Option<ExistingCapability> {
        let lower_obj = objective.to_lowercase();

        let domains: &[(&str, &[&str], &[&str])] = &[
            (
                "Authentication & Session Management",
                &[
                    "auth",
                    "authentication",
                    "login",
                    "signin",
                    "signup",
                    "session",
                    "jwt",
                    "credential",
                    "oauth",
                    "passkey",
                    "user context",
                ],
                &[
                    "auth",
                    "session",
                    "login",
                    "user",
                    "jwt",
                    "token",
                    "credential",
                    "provider",
                    "store",
                ],
            ),
            (
                "State Management",
                &[
                    "state management",
                    "global state",
                    "redux",
                    "zustand",
                    "context store",
                    "store",
                    "atoms",
                ],
                &[
                    "store", "context", "reducer", "zustand", "redux", "slice", "atom",
                ],
            ),
            (
                "Database & ORM Layer",
                &[
                    "database",
                    "orm",
                    "prisma",
                    "drizzle",
                    "sqlite",
                    "postgres",
                    "mysql",
                    "migrations",
                ],
                &[
                    "db",
                    "schema",
                    "prisma",
                    "drizzle",
                    "model",
                    "repository",
                    "migration",
                ],
            ),
            (
                "Routing & Navigation",
                &["routing", "router", "navigation", "nav bar", "pages route"],
                &["router", "route", "nav", "navigation", "routes"],
            ),
        ];

        for (domain_name, triggers, search_keywords) in domains {
            if triggers.iter().any(|t| lower_obj.contains(t)) {
                let mut matching_files = Vec::new();
                let mut matching_symbols = Vec::new();

                if let Ok(conn) = db.lock() {
                    for kw in *search_keywords {
                        let pattern = format!("%{}%", kw);
                        if let Ok(mut stmt) = conn.prepare("SELECT DISTINCT file_path, name FROM symbols WHERE project_id = ?1 AND name LIKE ?2 LIMIT 10") {
                            if let Ok(rows) = stmt.query_map(rusqlite::params![project_id, pattern], |r| {
                                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
                            }) {
                                for row in rows.flatten() {
                                    if !matching_files.contains(&row.0) {
                                        matching_files.push(row.0);
                                    }
                                    if !matching_symbols.contains(&row.1) && matching_symbols.len() < 8 {
                                        matching_symbols.push(row.1);
                                    }
                                }
                            }
                        }
                    }
                }

                // If DB has no symbols yet, scan files on disk
                if matching_files.is_empty() {
                    let walker = ignore::WalkBuilder::new(project_path)
                        .hidden(false)
                        .git_ignore(true)
                        .build();
                    for entry in walker.flatten() {
                        if entry.path().is_file() {
                            let rel = entry
                                .path()
                                .strip_prefix(project_path)
                                .unwrap_or(entry.path())
                                .to_string_lossy()
                                .replace("\\", "/");
                            if rel.contains("node_modules")
                                || rel.contains(".git")
                                || rel.contains("target")
                            {
                                continue;
                            }
                            let lower_rel = rel.to_lowercase();
                            if search_keywords
                                .iter()
                                .filter(|kw| lower_rel.contains(*kw))
                                .count()
                                >= 2
                            {
                                matching_files.push(rel);
                                if matching_files.len() >= 5 {
                                    break;
                                }
                            }
                        }
                    }
                }

                if !matching_files.is_empty() {
                    return Some(ExistingCapability {
                        domain: domain_name.to_string(),
                        primary_files: matching_files,
                        key_symbols: matching_symbols,
                        recommendation: format!(
                            "Existing capability '{}' is already established in this project. Extend or modify the existing files instead of creating parallel subsystems.",
                            domain_name
                        ),
                    });
                }
            }
        }

        None
    }

    /// Extract just the relevant tokens/symbols instead of full files.
    pub fn optimize_tokens(file_content: &str, _objective: &str) -> String {
        let lines: Vec<&str> = file_content.lines().collect();
        if lines.len() > 300 {
            let mut optimized = String::new();
            optimized.push_str("// [Optimized Context: Showing only imports and signatures]\n");
            for (i, line) in lines.iter().enumerate() {
                let trimmed = line.trim();
                if trimmed.starts_with("import ")
                    || trimmed.starts_with("export ")
                    || trimmed.starts_with("pub fn ")
                    || trimmed.starts_with("class ")
                {
                    optimized.push_str(line);
                    optimized.push('\n');
                } else if i < 20 {
                    // Always show top of file
                    optimized.push_str(line);
                    optimized.push('\n');
                }
            }
            optimized
        } else {
            file_content.to_string() // Small enough, keep whole file
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn test_expand_semantic_concepts_login_persistence() {
        let concepts = ContextEngine::expand_semantic_concepts("make user login persistent");
        assert!(concepts.contains(&"login".to_string()));
        assert!(concepts.contains(&"session".to_string()));
        assert!(
            concepts.contains(&"persist".to_string())
                || concepts.contains(&"persistence".to_string())
        );
        assert!(concepts.contains(&"store".to_string()));
        assert!(concepts.contains(&"provider".to_string()));
        assert!(concepts.contains(&"token".to_string()));
    }

    #[test]
    fn test_multi_hop_dependency_retrieval() {
        let temp_dir =
            std::env::temp_dir().join(format!("forge_context_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir.join("src")).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        // 1. Files on disk
        std::fs::write(
            temp_dir.join("src/UserLogin.tsx"),
            "export const UserLogin = () => {};",
        )
        .unwrap();
        std::fs::write(
            temp_dir.join("src/SessionProvider.tsx"),
            "export const SessionProvider = () => {};",
        )
        .unwrap();
        std::fs::write(
            temp_dir.join("src/AuthStore.ts"),
            "export const authStore = {};",
        )
        .unwrap();

        // 2. Setup SQLite with graph dependencies: UserLogin -> SessionProvider -> AuthStore
        let db_path = temp_dir.join("test_ctx.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let db = Mutex::new(conn);
        crate::services::graph::init_graph_db(&db).unwrap();

        let proj_id = "test_proj";
        let edge1 = crate::services::graph::Edge {
            source: "src/UserLogin.tsx".to_string(),
            target: "src/SessionProvider.tsx".to_string(),
            project_id: Some(proj_id.to_string()),
            relationship: "imports".to_string(),
        };
        let edge2 = crate::services::graph::Edge {
            source: "src/SessionProvider.tsx".to_string(),
            target: "src/AuthStore.ts".to_string(),
            project_id: Some(proj_id.to_string()),
            relationship: "imports".to_string(),
        };
        crate::services::graph::insert_edge(&db, &edge1).unwrap();
        crate::services::graph::insert_edge(&db, &edge2).unwrap();

        // 3. Rank context with active_files containing UserLogin.tsx
        let ranked = ContextEngine::rank_context(
            project_path,
            "make user login persistent",
            &["src/UserLogin.tsx".to_string()],
            &db,
            proj_id,
        );

        let ranked_paths: Vec<&str> = ranked.iter().map(|c| c.file_path.as_str()).collect();

        // All 3 files must be retrieved: UserLogin (active/semantic), SessionProvider (1-hop), AuthStore (2-hop)
        assert!(ranked_paths.contains(&"src/UserLogin.tsx"));
        assert!(ranked_paths.contains(&"src/SessionProvider.tsx"));
        assert!(ranked_paths.contains(&"src/AuthStore.ts"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_detect_existing_capability_auth() {
        let temp_dir =
            std::env::temp_dir().join(format!("forge_cap_test_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir.join("src/services")).unwrap();
        let project_path = temp_dir.to_str().unwrap();

        std::fs::write(
            temp_dir.join("src/services/UserSessionManager.ts"),
            "export class UserSessionManager { getSession() {} }",
        )
        .unwrap();

        let db_path = temp_dir.join("test_cap.db");
        let conn = crate::db::init_db(&db_path).unwrap();
        let db = Mutex::new(conn);

        // Index the symbol
        let proj_id = crate::services::filesystem::compute_project_id(project_path);
        {
            let c = db.lock().unwrap();
            c.execute(
                "INSERT INTO symbols (file_path, project_id, name, kind, start_line, end_line) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params!["src/services/UserSessionManager.ts", proj_id, "UserSessionManager", "class", 1, 1],
            ).unwrap();
        }

        let cap = ContextEngine::detect_existing_capability(
            project_path,
            "Add authentication system",
            &db,
            &proj_id,
        );
        assert!(cap.is_some());
        let capability = cap.unwrap();
        assert!(capability.domain.contains("Authentication"));
        assert!(capability
            .primary_files
            .contains(&"src/services/UserSessionManager.ts".to_string()));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
