use rusqlite::Connection;
use std::path::Path;
use std::sync::Mutex;

pub fn analyze_codebase(
    db: &Mutex<Connection>,
    active_files: &[String],
    project_path: &str,
) -> String {
    let mut warnings = Vec::new();

    for file in active_files {
        // 1. Massive Component Check
        let full_path = Path::new(project_path).join(file);
        let content = std::fs::read_to_string(&full_path).unwrap_or_default();
        let lines = content.lines().count();
        if lines > 150 {
            warnings.push(format!(
                "- [Large Component]: `{}` is {} lines long. Consider breaking it down.",
                file, lines
            ));
        }

        // 2. Forgotten Tests Check
        // Simple heuristic: if it's a src file, check if a test file exists.
        if file.starts_with("src/")
            && (file.ends_with(".rs") || file.ends_with(".ts") || file.ends_with(".js"))
        {
            let file_name = Path::new(file)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy();
            let base_name = file_name
                .trim_end_matches(".rs")
                .trim_end_matches(".ts")
                .trim_end_matches(".js");

            // Check rust standard tests directory or sibling test files
            let test_path = Path::new(project_path)
                .join("tests")
                .join(format!("{}.rs", base_name));
            let spec_path = Path::new(project_path)
                .join("src")
                .join(format!("{}.spec.ts", base_name));
            let test_mod_path = Path::new(project_path)
                .join("tests")
                .join(format!("{}_test.rs", base_name));

            let has_test = test_path.exists()
                || spec_path.exists()
                || test_mod_path.exists()
                || content.contains("#[cfg(test)]");
            if !has_test {
                warnings.push(format!("- [Forgotten Tests]: `{}` was modified but has no obvious corresponding tests.", file));
            }
        }

        // 3. Circular Dependency Detection
        let project_id = crate::services::filesystem::compute_project_id(project_path);
        if let Ok(edges) = crate::services::graph::query_dependencies(db, file, Some(&project_id)) {
            for edge in edges {
                // Check if target also depends on file
                if let Ok(target_edges) =
                    crate::services::graph::query_dependencies(db, &edge.target, Some(&project_id))
                {
                    if target_edges.iter().any(|e| e.target == *file) {
                        warnings.push(format!(
                            "- [Circular Dependency]: `{}` and `{}` mutually depend on each other.",
                            file, edge.target
                        ));
                    }
                }
            }
        }
    }

    if warnings.is_empty() {
        String::new()
    } else {
        warnings.join("\n")
    }
}
