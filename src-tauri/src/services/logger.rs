use tracing::{info, error, debug};
use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize)]
#[allow(dead_code)]
pub enum Subsystem {
    AI,
    IPC,
    Indexing,
    Search,
    Git,
    FileSystem,
    Plugins,
}

impl std::fmt::Display for Subsystem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

pub struct ForgeLogger;

impl ForgeLogger {
    pub fn log_event(subsystem: Subsystem, message: &str, duration: Option<std::time::Duration>, error_details: Option<&str>) {
        let duration_ms = duration.map(|d| d.as_millis()).unwrap_or(0);
        
        if let Some(err) = error_details {
            error!(
                subsystem = %subsystem,
                duration_ms = duration_ms,
                error = err,
                "{}", message
            );
        } else {
            info!(
                subsystem = %subsystem,
                duration_ms = duration_ms,
                "{}", message
            );
        }
    }

    #[allow(dead_code)]
    pub fn debug(subsystem: Subsystem, message: &str) {
        debug!(subsystem = %subsystem, "{}", message);
    }
}
