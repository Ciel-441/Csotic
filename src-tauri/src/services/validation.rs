use std::process::Command;
use serde::Serialize;

#[derive(Serialize)]
pub struct ValidationResult {
    pub success: bool,
    pub step: String,
    pub output: String,
}

pub struct Validator;

impl Validator {
    pub fn run_all(project_path: &str) -> Vec<ValidationResult> {
        let mut results = Vec::new();

        // 1. Type Checker / Linter (non-mutating verification)

        // 2. Type Checker / Linter
        let lint_cmd = if std::path::Path::new(project_path).join("tsconfig.json").exists() {
            Command::new("npx").arg("tsc").arg("--noEmit").current_dir(project_path).output()
        } else {
            Command::new("cargo").arg("check").current_dir(project_path).output()
        };

        if let Ok(output) = lint_cmd {
            let out_str = String::from_utf8_lossy(if output.status.success() { &output.stdout } else { &output.stderr }).to_string();
            results.push(ValidationResult {
                success: output.status.success(),
                step: "Type Checking / Linting".to_string(),
                output: out_str,
            });
        }

        results
    }
}
