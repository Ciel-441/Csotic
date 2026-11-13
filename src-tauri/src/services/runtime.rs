use std::sync::RwLock;
use once_cell::sync::Lazy;

// In-memory cache of recent runtime exceptions mapped to file paths
pub static ACTIVE_EXCEPTIONS: Lazy<RwLock<Vec<String>>> = Lazy::new(|| RwLock::new(Vec::new()));

pub fn ingest_log(log_line: &str) {
    let lower = log_line.to_lowercase();
    if lower.contains("exception") || lower.contains("error") || lower.contains("panic") {
        // Simple extraction: look for something that looks like a file path and line number
        // e.g. src/main.rs:45
        let tokens: Vec<&str> = log_line.split_whitespace().collect();
        for token in tokens {
            if token.contains(".rs:") || token.contains(".ts:") || token.contains(".js:") {
                let mut exceptions = match ACTIVE_EXCEPTIONS.write() {
                    Ok(guard) => guard,
                    Err(poisoned) => poisoned.into_inner(),
                };
                let warning = format!("RUNTIME EXCEPTION: Found error in log traced to `{}` - Context: {}", token, log_line);
                if !exceptions.contains(&warning) {
                    exceptions.push(warning);
                }
                // keep only last 50
                if exceptions.len() > 50 {
                    exceptions.remove(0);
                }
            }
        }
    }
}

pub fn get_runtime_warnings() -> Vec<String> {
    let exceptions = match ACTIVE_EXCEPTIONS.read() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    exceptions.clone()
}
