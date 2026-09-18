use std::fs;
use std::path::Path;
use crate::services::symbols::extract_symbols;

pub fn analyze_refactoring(active_files: &[String], project_path: &str) -> Vec<String> {
    let mut recommendations = Vec::new();

    for file in active_files {
        let full_path = Path::new(project_path).join(file);
        if let Ok(content) = fs::read_to_string(&full_path) {
            let lines = content.lines().count();
            
            // 1. God File Heuristic
            if lines > 400 {
                recommendations.push(format!("REFACTORING TARGET: `{}` is over 400 lines (God File). Consider splitting it into smaller, focused modules.", file));
            }

            // 2. God Function Heuristic
            if file.ends_with(".rs") || file.ends_with(".ts") || file.ends_with(".js") {
                let symbols = extract_symbols(&full_path, &content);
                for sym in symbols {
                    if sym.kind == "function" {
                        let func_len = sym.end_line.saturating_sub(sym.start_line);
                        if func_len > 100 {
                            recommendations.push(format!("REFACTORING TARGET: Function `{}` in `{}` is {} lines long (God Function). Extract internal logic into helper functions.", sym.name, file, func_len));
                        }
                    }
                }
            }
        }
    }
    
    recommendations.into_iter().take(10).collect()
}
