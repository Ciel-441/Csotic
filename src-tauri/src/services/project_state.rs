use std::path::Path;
use serde::{Deserialize, Serialize};
use ignore::WalkBuilder;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum ProjectType {
    TauriReact,
    NextJs,
    ViteReact,
    ViteVue,
    SvelteKit,
    Rust,
    Python,
    Node,
    Go,
    Empty,
    MultiProject,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectState {
    pub workspace_root: String,
    pub project_exists: bool,
    pub project_type: ProjectType,
    pub project_type_name: String,
    pub package_manager: String,
    pub file_count: usize,
    pub directory_count: usize,
    pub entry_points: Vec<String>,
    pub important_files: Vec<String>,
    pub existing_files: Vec<String>,
    pub is_git: bool,
    pub summary: String,
}

pub struct ProjectDetector;

impl ProjectDetector {
    /// Detects the project state and architecture by inspecting the filesystem directly.
    pub fn detect(project_path: &str) -> ProjectState {
        let root = Path::new(project_path);
        if !root.is_dir() {
            return ProjectState {
                workspace_root: project_path.to_string(),
                project_exists: false,
                project_type: ProjectType::Empty,
                project_type_name: "Empty / Missing Directory".to_string(),
                package_manager: "none".to_string(),
                file_count: 0,
                directory_count: 0,
                entry_points: Vec::new(),
                important_files: Vec::new(),
                existing_files: Vec::new(),
                is_git: false,
                summary: "Workspace directory is empty or does not exist.".to_string(),
            };
        }

        let is_git = root.join(".git").exists();
        let has_package_json = root.join("package.json").is_file();
        let has_cargo_toml = root.join("Cargo.toml").is_file();
        let has_pyproject = root.join("pyproject.toml").is_file() || root.join("requirements.txt").is_file() || root.join("Pipfile").is_file();
        let has_go_mod = root.join("go.mod").is_file();
        let has_tauri_conf = root.join("src-tauri").join("tauri.conf.json").is_file() || root.join("tauri.conf.json").is_file();
        let has_vite = root.join("vite.config.ts").is_file() || root.join("vite.config.js").is_file() || root.join("vite.config.mjs").is_file();
        let has_next = root.join("next.config.js").is_file() || root.join("next.config.mjs").is_file() || root.join("next.config.ts").is_file();
        let has_svelte = root.join("svelte.config.js").is_file();

        // Scan files & directories using ignore walker (respects .gitignore)
        let mut file_count = 0;
        let mut dir_count = 0;
        let mut existing_files: Vec<String> = Vec::new();

        let walker = WalkBuilder::new(project_path)
            .hidden(false)
            .git_ignore(true)
            .max_depth(Some(8))
            .build();

        for result in walker.flatten() {
            let path = result.path();
            if path == root {
                continue;
            }

            let path_str = path.to_string_lossy();
            if path_str.contains(".git") || path_str.contains("node_modules") 
                || path_str.contains("target") || path_str.contains(".next") 
                || path_str.contains("dist") || path_str.contains(".cargo") {
                continue;
            }

            let rel = path.strip_prefix(root).unwrap_or(path).to_string_lossy().replace('\\', "/");

            if path.is_dir() {
                dir_count += 1;
            } else if path.is_file() {
                file_count += 1;
                if existing_files.len() < 300 {
                    existing_files.push(rel);
                }
            }
        }

        let project_exists = file_count > 0 && (has_package_json || has_cargo_toml || has_pyproject || has_go_mod || is_git || file_count >= 3);

        // Determine Package Manager
        let package_manager = if root.join("pnpm-lock.yaml").is_file() {
            "pnpm".to_string()
        } else if root.join("yarn.lock").is_file() {
            "yarn".to_string()
        } else if root.join("bun.lockb").is_file() || root.join("bun.lock").is_file() {
            "bun".to_string()
        } else if root.join("package-lock.json").is_file() || has_package_json {
            "npm".to_string()
        } else if has_cargo_toml {
            "cargo".to_string()
        } else if has_pyproject {
            "pip/poetry".to_string()
        } else if has_go_mod {
            "go".to_string()
        } else {
            "none".to_string()
        };

        // Determine Project Type
        let (project_type, project_type_name) = if has_tauri_conf {
            (ProjectType::TauriReact, "Tauri + Web App".to_string())
        } else if has_next {
            (ProjectType::NextJs, "Next.js Application".to_string())
        } else if has_vite {
            (ProjectType::ViteReact, "Vite Single Page App".to_string())
        } else if has_svelte {
            (ProjectType::SvelteKit, "SvelteKit App".to_string())
        } else if has_cargo_toml && !has_package_json {
            (ProjectType::Rust, "Rust Project".to_string())
        } else if has_pyproject && !has_package_json {
            (ProjectType::Python, "Python Project".to_string())
        } else if has_go_mod {
            (ProjectType::Go, "Go Project".to_string())
        } else if has_package_json {
            (ProjectType::Node, "Node.js / JavaScript Project".to_string())
        } else if !project_exists {
            (ProjectType::Empty, "Empty Workspace".to_string())
        } else {
            (ProjectType::Unknown, "Generic Codebase".to_string())
        };

        // Discover Entry Points
        let potential_entries = [
            "src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js",
            "src/index.tsx", "src/index.ts", "src/index.jsx", "src/index.js",
            "src/App.tsx", "src/App.jsx", "src/App.vue",
            "src/main.rs", "src/lib.rs", "src-tauri/src/main.rs", "src-tauri/src/lib.rs",
            "main.py", "app.py", "index.js", "main.go", "index.html"
        ];
        let mut entry_points = Vec::new();
        for entry in potential_entries {
            if root.join(entry).is_file() {
                entry_points.push(entry.to_string());
            }
        }

        // Discover Important Config / Architecture Files
        let potential_configs = [
            "package.json", "Cargo.toml", "tsconfig.json", "vite.config.ts", "vite.config.js",
            "next.config.js", "next.config.mjs", "tauri.conf.json", "src-tauri/tauri.conf.json",
            "tailwind.config.js", "tailwind.config.ts", "README.md", ".env.example", ".env"
        ];
        let mut important_files = Vec::new();
        for cfg in potential_configs {
            if root.join(cfg).is_file() {
                important_files.push(cfg.to_string());
            }
        }

        let summary = format!(
            "Workspace State: {}\nType: {}\nPackage Manager: {}\nFiles: {} across {} directories\nEntry Points: {}\nKey Configs: {}",
            if project_exists { "EXISTING PROJECT (MODIFY ONLY)" } else { "EMPTY WORKSPACE (CREATION ALLOWED)" },
            project_type_name,
            package_manager,
            file_count,
            dir_count,
            if entry_points.is_empty() { "None discovered".to_string() } else { entry_points.join(", ") },
            if important_files.is_empty() { "None discovered".to_string() } else { important_files.join(", ") }
        );

        ProjectState {
            workspace_root: project_path.to_string(),
            project_exists,
            project_type,
            project_type_name,
            package_manager,
            file_count,
            directory_count: dir_count,
            entry_points,
            important_files,
            existing_files,
            is_git,
            summary,
        }
    }

    /// Checks if a proposed file creation is a suspicious recreation of an existing project's root files.
    pub fn is_suspicious_recreation(state: &ProjectState, relative_path: &str) -> bool {
        if !state.project_exists {
            return false;
        }

        let clean_path = relative_path.trim().replace('\\', "/").trim_start_matches('/').to_string();

        // 1. Root configuration manifests and entry points that already exist
        let core_manifests = [
            "package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lockb", "bun.lock",
            "Cargo.toml", "Cargo.lock", "pyproject.toml", "requirements.txt", "Pipfile", "go.mod", "go.sum",
            "pom.xml", "build.gradle", "Gemfile", "composer.json", "deno.json",
            "tsconfig.json", "jsconfig.json", "vite.config.ts", "vite.config.js", "vite.config.mjs",
            "next.config.js", "next.config.mjs", "next.config.ts", "svelte.config.js",
            "tauri.conf.json", "src-tauri/tauri.conf.json", "tailwind.config.js", "tailwind.config.ts",
            "index.html", "src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js",
            "src/index.tsx", "src/index.ts", "src/index.jsx", "src/index.js",
            "src/App.tsx", "src/App.jsx", "src/App.vue", "src/main.rs", "src/lib.rs"
        ];

        for core in core_manifests {
            if clean_path.eq_ignore_ascii_case(core) && (state.important_files.iter().any(|f| f.eq_ignore_ascii_case(core)) || state.entry_points.iter().any(|f| f.eq_ignore_ascii_case(core))) {
                return true;
            }
        }

        // 2. Nested duplicate project root (e.g. workspace already has a project, but AI creates 'app/package.json', 'client/Cargo.toml', etc.)
        let known_submanifests = [
            "package.json", "Cargo.toml", "pyproject.toml", "go.mod", "pom.xml", "build.gradle",
            "vite.config.ts", "vite.config.js", "next.config.js", "next.config.mjs", "tsconfig.json"
        ];

        let parts: Vec<&str> = clean_path.split('/').collect();
        if parts.len() >= 2 {
            let last = parts[parts.len() - 1];
            if known_submanifests.iter().any(|m| last.eq_ignore_ascii_case(m)) {
                // If the root already has this type of manifest (e.g. root has package.json and AI proposes subfolder/package.json)
                if state.important_files.iter().any(|f| f.ends_with(last)) {
                    return true;
                }
            }
        }

        false
    }

    /// Extended semantic duplicate detection using path synonyms, symbol overlap, and content analysis.
    pub fn find_semantic_duplication_with_content(
        state: &ProjectState,
        proposed_path: &str,
        proposed_content: Option<&str>,
    ) -> Option<(String, String)> {
        let proposed_clean = proposed_path.trim().replace('\\', "/").trim_start_matches('/').to_string();
        let proposed_raw_stem = std::path::Path::new(&proposed_clean)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        let proposed_stem = proposed_raw_stem.to_lowercase();
        
        if proposed_stem.len() < 3 {
            return None;
        }

        let extract_words = |s: &str| -> Vec<String> {
            let mut words = Vec::new();
            let mut current = String::new();
            for ch in s.chars() {
                if ch == '_' || ch == '-' || ch == '.' || ch == '/' || ch == '\\' {
                    if !current.is_empty() {
                        words.push(current.to_lowercase());
                        current.clear();
                    }
                } else if ch.is_uppercase() && !current.is_empty() {
                    words.push(current.to_lowercase());
                    current.clear();
                    current.push(ch);
                } else {
                    current.push(ch);
                }
            }
            if !current.is_empty() {
                words.push(current.to_lowercase());
            }
            words
        };

        let proposed_words = extract_words(proposed_raw_stem);

        // Extended domain semantic clusters
        let clusters: &[&[&str]] = &[
            &["auth", "authentication", "login", "signin", "signup", "user", "session", "credential", "account", "identity", "token", "jwt", "pass"],
            &["state", "store", "context", "provider", "reducer", "atom", "slice"],
            &["service", "client", "api", "handler", "manager", "controller", "adapter", "facade", "agent", "orchestrator", "worker"],
            &["route", "router", "navigation", "nav", "view", "page", "screen"],
            &["database", "db", "repository", "dao", "store", "model", "schema", "entity"],
            &["util", "utils", "helper", "helpers", "lib", "common", "shared", "core"],
            &["config", "settings", "options", "env", "environment"],
            &["cache", "buffer", "storage", "pool", "vault"],
        ];

        // Extract proposed symbols if content is available
        let proposed_symbols: Vec<String> = if let Some(content) = proposed_content {
            crate::services::symbols::extract_symbols(&std::path::Path::new(proposed_path), content)
                .into_iter()
                .map(|s| s.name.to_lowercase())
                .collect()
        } else {
            Vec::new()
        };

        for existing in &state.existing_files {
            if existing.eq_ignore_ascii_case(&proposed_clean) {
                continue;
            }
            let existing_clean = existing.trim().replace('\\', "/").trim_start_matches('/').to_string();
            let existing_raw_stem = std::path::Path::new(&existing_clean)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            let existing_stem = existing_raw_stem.to_lowercase();

            if existing_stem.len() < 3 {
                continue;
            }

            let existing_words = extract_words(existing_raw_stem);

            // 1. Direct prefix / abbreviation match (e.g. AuthProvider vs AuthenticationProvider)
            let is_abbr_match = (existing_stem.starts_with("auth") && proposed_stem.starts_with("authentication"))
                || (proposed_stem.starts_with("auth") && existing_stem.starts_with("authentication"));

            // 2. Shared root words & semantic synonym cluster matches
            let mut shared = 0;
            let mut matched_terms = Vec::new();
            for pw in &proposed_words {
                for ew in &existing_words {
                    let is_exact = pw == ew || (pw.starts_with(ew) && ew.len() >= 4) || (ew.starts_with(pw) && pw.len() >= 4);
                    let is_synonym = clusters.iter().any(|c| c.contains(&pw.as_str()) && c.contains(&ew.as_str()));
                    if is_exact || is_synonym {
                        shared += 1;
                        matched_terms.push(format!("{pw}~{ew}"));
                        break;
                    }
                }
            }

            if is_abbr_match {
                return Some((existing.clone(), format!("Prefix / abbreviation match: '{}' vs '{}'", proposed_stem, existing_stem)));
            }

            if shared >= 2 && shared >= proposed_words.len().min(existing_words.len()) {
                return Some((
                    existing.clone(),
                    format!("Shared domain responsibility (matches: {})", matched_terms.join(", "))
                ));
            }

            // 3. Symbol / identifier overlap if proposed symbols are extracted
            if !proposed_symbols.is_empty() {
                let symbol_matches: Vec<_> = proposed_symbols.iter()
                    .filter(|sym| {
                        let sym_lower = sym.to_lowercase();
                        existing_words.iter().any(|ew| sym_lower.contains(ew) || ew.contains(&sym_lower))
                            || clusters.iter().any(|c| c.iter().any(|w| sym_lower.contains(w)) && c.iter().any(|w| existing_stem.contains(w)))
                    })
                    .cloned()
                    .collect();

                if symbol_matches.len() >= 2 || (symbol_matches.len() == 1 && shared >= 1) {
                    return Some((
                        existing.clone(),
                        format!("Symbol and responsibility overlap (symbols: [{}])", symbol_matches.join(", "))
                    ));
                }
            }
        }

        None
    }

    /// Checks for semantic duplication against existing project components (e.g. AuthProvider.tsx vs AuthenticationProvider.tsx)
    pub fn find_semantic_duplication(state: &ProjectState, proposed_path: &str) -> Option<String> {
        Self::find_semantic_duplication_with_content(state, proposed_path, None).map(|(file, _)| file)
    }
}
