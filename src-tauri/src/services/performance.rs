use std::fs;
use std::path::Path;

pub fn analyze_performance(active_files: &[String], project_path: &str) -> Vec<String> {
    let mut warnings = Vec::new();

    for file in active_files {
        let full_path = Path::new(project_path).join(file);
        if let Ok(content) = fs::read_to_string(&full_path) {
            // Check for nested loops (naive text check)
            let mut for_count = 0;
            for line in content.lines() {
                if line.contains("for ") && line.contains("{") {
                    for_count += 1;
                }
                if line.contains("}") && for_count > 0 {
                    for_count -= 1;
                }
                if for_count >= 3 {
                    warnings.push(format!("PERFORMANCE RISK: Triply nested loop detected in `{}`. O(N^3) complexity risk.", file));
                    break;
                }
            }

            // Check for React unnecessary renders
            if (file.ends_with(".tsx") || file.ends_with(".jsx"))
                && content.contains("useEffect(() => {") && !content.contains("}, [") {
                    warnings.push(format!("PERFORMANCE RISK: `useEffect` missing dependency array in `{}`. This will trigger unnecessary renders on every update.", file));
                }
            
            // Check for basic N+1 queries
            if content.contains("SELECT ") && for_count > 0 {
                warnings.push(format!("PERFORMANCE RISK: Potential N+1 query detected inside a loop in `{}`.", file));
            }
        }
    }
    
    // limit warnings to top 10 to avoid token bloat
    warnings.into_iter().take(10).collect()
}
