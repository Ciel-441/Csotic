use std::process::Command;

fn run_git(cwd: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.args(args).current_dir(cwd);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run git: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git {} failed: {}", args.join(" "), stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn handle(action: &str, payload: &serde_json::Value) -> Result<serde_json::Value, String> {
    let cwd = payload.get("project_path").and_then(|v| v.as_str())
        .ok_or("Missing 'project_path'")?;

    match action {
        "status" => {
            let out = run_git(cwd, &["status", "--porcelain"])?;
            Ok(serde_json::json!({ "status": out }))
        }
        "diff" => {
            let file_path = payload.get("path").and_then(|v| v.as_str());
            let out = match file_path {
                Some(p) => run_git(cwd, &["diff", "--", p])?,
                None => run_git(cwd, &["diff"])?,
            };
            Ok(serde_json::json!({ "diff": out }))
        }
        "show" => {
            let path = payload.get("path").and_then(|v| v.as_str())
                .ok_or("Missing 'path'")?;
            let out = run_git(cwd, &["show", &format!("HEAD:{path}")])?;
            Ok(serde_json::json!({ "content": out }))
        }
        "numstat" => {
            let out = run_git(cwd, &["diff", "--numstat"])?;
            Ok(serde_json::json!({ "numstat": out }))
        }
        "add" => {
            let path = payload.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            run_git(cwd, &["add", path])?;
            Ok(serde_json::json!({ "added": true }))
        }
        "commit" => {
            let message = payload.get("message").and_then(|v| v.as_str())
                .ok_or("Missing 'message'")?;
            let out = run_git(cwd, &["commit", "-m", message])?;
            Ok(serde_json::json!({ "committed": true, "output": out }))
        }
        "branch" => {
            let out = run_git(cwd, &["branch", "--list"])?;
            Ok(serde_json::json!({ "branches": out }))
        }
        "checkout" => {
            let target = payload.get("target").and_then(|v| v.as_str())
                .ok_or("Missing 'target'")?;
            let out = run_git(cwd, &["checkout", target])?;
            Ok(serde_json::json!({ "success": true, "output": out }))
        }
        "reset_hard" => {
            let approved = payload.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
            if !approved { return Err("Permission denied: git reset --hard requires approval".into()); }
            let out = run_git(cwd, &["reset", "--hard"])?;
            Ok(serde_json::json!({ "success": true, "output": out }))
        }
        "force_push" => {
            let approved = payload.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
            if !approved { return Err("Permission denied: force push requires approval".into()); }
            let out = run_git(cwd, &["push", "--force"])?;
            Ok(serde_json::json!({ "success": true, "output": out }))
        }
        "branch_delete" => {
            let branch = payload.get("branch").and_then(|v| v.as_str())
                .ok_or("Missing 'branch'")?;
            let approved = payload.get("approved").and_then(|v| v.as_bool()).unwrap_or(false);
            if !approved { return Err("Permission denied: branch delete requires approval".into()); }
            let out = run_git(cwd, &["branch", "-D", branch])?;
            Ok(serde_json::json!({ "success": true, "output": out }))
        }
        "stash" => {
            let sub = payload.get("subaction").and_then(|v| v.as_str()).unwrap_or("push");
            let out = match sub {
                "pop" => run_git(cwd, &["stash", "pop"])?,
                _ => run_git(cwd, &["stash"])?,
            };
            Ok(serde_json::json!({ "success": true, "output": out }))
        }
        "pull" => {
            let out = run_git(cwd, &["pull"])?;
            Ok(serde_json::json!({ "success": true, "output": out }))
        }
        "push" => {
            let out = run_git(cwd, &["push"])?;
            Ok(serde_json::json!({ "success": true, "output": out }))
        }
        "unstage" => {
            let path = payload.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            let out = run_git(cwd, &["restore", "--staged", path])
                .or_else(|_| run_git(cwd, &["reset", "HEAD", path]))?;
            Ok(serde_json::json!({ "success": true, "output": out }))
        }
        "discard" => {
            let path = payload.get("path").and_then(|v| v.as_str()).ok_or("Missing 'path'")?;
            let _ = run_git(cwd, &["restore", path])
                .or_else(|_| run_git(cwd, &["checkout", "--", path]));
            let _ = run_git(cwd, &["clean", "-f", "-d", path]);
            Ok(serde_json::json!({ "success": true }))
        }
        "create_branch" => {
            let name = payload.get("name").and_then(|v| v.as_str()).ok_or("Missing 'name'")?;
            let out = run_git(cwd, &["checkout", "-b", name])?;
            Ok(serde_json::json!({ "success": true, "output": out }))
        }
        "log" => {
            let limit = payload.get("limit").and_then(|v| v.as_u64()).unwrap_or(25);
            let limit_str = format!("-n{}", limit);
            let out = run_git(cwd, &["log", "--pretty=format:%h|%an|%ar|%s", &limit_str])
                .unwrap_or_default();
            let mut commits = Vec::new();
            for line in out.lines() {
                let parts: Vec<&str> = line.splitn(4, '|').collect();
                if parts.len() == 4 {
                    commits.push(serde_json::json!({
                        "hash": parts[0],
                        "author": parts[1],
                        "date": parts[2],
                        "message": parts[3],
                    }));
                }
            }
            Ok(serde_json::json!({ "commits": commits }))
        }
        _ => Err(format!("Unknown git action: {action}")),
    }
}
