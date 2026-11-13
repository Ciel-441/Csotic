use std::fs;
use std::path::Path;

/// Performs static security analysis on active files in the workspace.
/// Detects hardcoded secrets, SQL injection risks, unsafe execution, and dangerous DOM operations.
pub fn scan_codebase(active_files: &[String], project_path: &str) -> String {
    let mut warnings: Vec<String> = Vec::new();

    for file in active_files {
        let full_path = Path::new(project_path).join(file);
        if let Ok(content) = fs::read_to_string(&full_path) {
            for (line_idx, line) in content.lines().enumerate() {
                let line_num = line_idx + 1;
                let trimmed = line.trim();

                // Skip comments
                if trimmed.starts_with("//")
                    || trimmed.starts_with("/*")
                    || trimmed.starts_with('#')
                    || trimmed.starts_with('*')
                {
                    continue;
                }

                // 1. Hardcoded Secrets & Token Leaks
                if (trimmed.contains("sk-")
                    || trimmed.contains("ghp_")
                    || trimmed.contains("AIza")
                    || trimmed.contains("xoxb-"))
                    && (trimmed.contains('=') || trimmed.contains(':'))
                    && !trimmed.contains("process.env")
                    && !trimmed.contains("std::env")
                    && !trimmed.contains("env::var")
                {
                    warnings.push(format!(
                        "- [CRITICAL SECRET LEAK]: Potential hardcoded API token/secret on line {} of `{}`.",
                        line_num, file
                    ));
                }

                if trimmed.contains("PRIVATE KEY-----") {
                    warnings.push(format!(
                        "- [CRITICAL SECRET LEAK]: Embedded private key detected on line {} of `{}`.",
                        line_num, file
                    ));
                }

                // 2. Dangerous Execution & Command Injection
                if (trimmed.contains("eval(")
                    || trimmed.contains("new Function(")
                    || trimmed.contains("window.eval"))
                    && (file.ends_with(".js")
                        || file.ends_with(".ts")
                        || file.ends_with(".tsx")
                        || file.ends_with(".jsx"))
                {
                    warnings.push(format!(
                        "- [HIGH CODE INJECTION]: Arbitrary code execution (`eval` / `new Function`) detected on line {} of `{}`.",
                        line_num, file
                    ));
                }

                if (trimmed.contains("child_process.exec(") || trimmed.contains("execSync("))
                    && !trimmed.contains("execFile")
                    && (file.ends_with(".js") || file.ends_with(".ts"))
                {
                    warnings.push(format!(
                        "- [COMMAND INJECTION RISK]: Raw shell command execution (`child_process.exec`) on line {} of `{}`.",
                        line_num, file
                    ));
                }

                // 3. XSS / Dangerous HTML Injection
                if trimmed.contains("dangerouslySetInnerHTML") || trimmed.contains("innerHTML =") {
                    warnings.push(format!(
                        "- [XSS RISK]: Direct HTML string injection (`innerHTML` / `dangerouslySetInnerHTML`) on line {} of `{}`.",
                        line_num, file
                    ));
                }

                // 4. SQL Injection Patterns
                if (trimmed.contains("SELECT ")
                    || trimmed.contains("INSERT INTO ")
                    || trimmed.contains("UPDATE ")
                    || trimmed.contains("DELETE FROM "))
                    && (trimmed.contains("format!(\"")
                        || (trimmed.contains(" + ")
                            && (trimmed.contains("req.")
                                || trimmed.contains("input")
                                || trimmed.contains("params"))))
                {
                    warnings.push(format!(
                        "- [SQL INJECTION RISK]: Dynamic SQL string concatenation detected on line {} of `{}`. Use parameterized queries.",
                        line_num, file
                    ));
                }
            }
        }
    }

    if warnings.is_empty() {
        String::new()
    } else {
        warnings.into_iter().take(10).collect::<Vec<_>>().join("\n")
    }
}
