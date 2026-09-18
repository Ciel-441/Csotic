use crate::ipc::types::RiskLevel;

/// Classify a shell command's risk level per §7 of the spec.
pub fn classify_risk(command: &str) -> RiskLevel {
    let c = command.to_lowercase();

    // Critical — destructive, irreversible, or dangerous
    if c.contains("rm -rf") || c.contains("del /s") || c.contains("format ")
        || c.contains("git push --force") || c.contains("git reset --hard")
        || c.contains("git branch -d") || c.contains("git branch -D")
        || c.contains("drop table") || c.contains("drop database")
        || c.contains("> /dev/") || c.contains(":(){ :|:&};:")
    {
        return RiskLevel::Critical;
    }

    // High — potentially destructive
    if c.starts_with("rm ") || c.contains("git checkout") || c.contains("git pull")
        || c.contains("npm publish")
        || (c.contains("pip install") && c.contains("--upgrade"))
        || c.contains("sudo")
    {
        return RiskLevel::High;
    }

    // Medium — modifying but generally safe
    if c.contains("npm install") || c.contains("pip install")
        || c.contains("git add") || c.contains("git commit")
    {
        return RiskLevel::Medium;
    }

    // Low — read-only, builds, tests, lint
    RiskLevel::Low
}

/// Build the JSON tool schemas for Ollama, filtered by permission profile
/// Build the JSON tool schemas for Ollama, filtered by permission profile
pub fn tool_schemas(permission: &str) -> Vec<serde_json::Value> {
    let mut tools = vec![
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "read_project_state",
                "description": "Inspect the authoritative workspace project state: project existence, framework/type, package manager, entry points, configuration manifests, and file counts.",
                "parameters": {
                    "type": "object",
                    "properties": {}
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read the full contents and SHA-256 hash of a file. REQUIRED before modifying any existing file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Canonical relative file path within workspace" }
                    },
                    "required": ["path"]
                }
            }
        }),
        serde_json::json!({
            "type": "function",
            "function": {
                "name": "list_dir",
                "description": "List files and subdirectories at a relative directory path.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Relative directory path (use empty string or '.' for project root)" }
                    },
                    "required": ["path"]
                }
            }
        }),
    ];

    if permission != "read_only" {
        tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": "create_file",
                "description": "CREATE ONLY: Creates a brand new file at the specified path. FAILS with FILE_ALREADY_EXISTS if the file already exists on disk (use modify_file or patch_file instead). If candidate existing files exist, providing 'justification' is required.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { 
                            "type": "string",
                            "description": "The relative file path to create (e.g. 'src/pages/Dashboard.tsx')." 
                        },
                        "content": { "type": "string", "description": "Complete new file content." },
                        "justification": { 
                            "type": "string", 
                            "description": "Architectural justification explaining why a brand new file is needed instead of extending existing similar files or capabilities." 
                        }
                    },
                    "required": ["path", "content"]
                }
            }
        }));

        tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": "modify_file",
                "description": "MODIFY EXISTING FILE: Updates an existing file. Fails if the file does not exist, has not been read first, or if expected_hash does not match the current disk hash.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Relative path of existing file." },
                        "expected_hash": { "type": "string", "description": "The SHA-256 hash obtained from read_file." },
                        "content": { "type": "string", "description": "The updated complete file content." }
                    },
                    "required": ["path", "content"]
                }
            }
        }));

        tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": "patch_file",
                "description": "PATCH EXISTING FILE: Replace one exact, unique occurrence of `target` text with `replacement`. Fails if file is missing, unread, or target string is ambiguous.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Relative path of existing file." },
                        "expected_hash": { "type": "string", "description": "The SHA-256 hash obtained from read_file (optional but recommended)." },
                        "target": { "type": "string", "description": "Exact text to find (must appear exactly once in the file)." },
                        "replacement": { "type": "string", "description": "New replacement text." }
                    },
                    "required": ["path", "target", "replacement"]
                }
            }
        }));

        tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": "replace_file",
                "description": "REPLACE FILE: Explicit full-file replacement for generated/schema files. Requires file to exist and hash verification.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Relative path of existing file." },
                        "expected_hash": { "type": "string", "description": "The SHA-256 hash obtained from read_file." },
                        "content": { "type": "string", "description": "New file content." }
                    },
                    "required": ["path", "content"]
                }
            }
        }));

        tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": "delete_file",
                "description": "DELETE FILE: Explicitly deletes a file or directory. Requires approved=true confirmation.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "Relative path to delete." },
                        "approved": { "type": "boolean", "description": "Must be true to confirm deletion." }
                    },
                    "required": ["path", "approved"]
                }
            }
        }));

        tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": "move_file",
                "description": "MOVE / RENAME FILE: Atomically moves a file from source to destination.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "source": { "type": "string", "description": "Relative path of existing file to move." },
                        "destination": { "type": "string", "description": "Relative path of destination." }
                    },
                    "required": ["source", "destination"]
                }
            }
        }));

        tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": "copy_file",
                "description": "COPY FILE: Copies a file from source to destination path.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "source": { "type": "string", "description": "Relative path of existing source file to copy." },
                        "destination": { "type": "string", "description": "Relative path of destination." }
                    },
                    "required": ["source", "destination"]
                }
            }
        }));

        tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": "create_dir",
                "description": "Create a directory (and parent directories as needed).",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string", "description": "The directory path to create relative to project root." }
                    },
                    "required": ["path"]
                }
            }
        }));
    }

    if permission == "developer" || permission == "full_automation" {
        tools.push(serde_json::json!({
            "type": "function",
            "function": {
                "name": "run_command",
                "description": "Run a shell command in the project root (e.g. tests, build, linter). Returns stdout, stderr, and exit code.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" }
                    },
                    "required": ["command"]
                }
            }
        }));
    }

    tools
}
