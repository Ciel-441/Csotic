use notify::{RecommendedWatcher, RecursiveMode, Watcher, Event, EventKind};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use rusqlite::Connection;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

pub struct ProjectWatcher {
    _watcher: Option<RecommendedWatcher>,
    active_path: Option<String>,
    _event_tx: Option<mpsc::UnboundedSender<WatchEvent>>,
}

struct WatchEvent {
    path_buf: PathBuf,
    kind: EventKind,
}

static WATCHER_STATE: Lazy<Arc<Mutex<ProjectWatcher>>> = Lazy::new(|| {
    Arc::new(Mutex::new(ProjectWatcher {
        _watcher: None,
        active_path: None,
        _event_tx: None,
    }))
});

/// Starts or updates the background filesystem watcher with debounced coalescing for the active workspace.
pub fn watch_workspace(project_path: &str, db: Arc<Mutex<Connection>>) -> Result<(), String> {
    let clean_path = if let Some(rest) = project_path.strip_prefix(r"\\?\") {
        rest
    } else if let Some(rest) = project_path.strip_prefix("//?/") {
        rest
    } else {
        project_path
    };

    let mut state = WATCHER_STATE.lock().map_err(|e| e.to_string())?;
    if state.active_path.as_deref() == Some(clean_path) {
        return Ok(()); // Already watching this path
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<WatchEvent>();
    let root_str = clean_path.replace('\\', "/");
    let root_str_clone = root_str.clone();
    let db_clone = db.clone();

    // Spawn a debouncer task that coalesces events within a 150ms window per relative path
    tokio::spawn(async move {
        let mut pending: HashMap<String, (PathBuf, Instant, bool)> = HashMap::new();
        let debounce_duration = Duration::from_millis(150);

        loop {
            tokio::select! {
                maybe_event = rx.recv() => {
                    match maybe_event {
                        Some(ev) => {
                            let path_str = ev.path_buf.to_string_lossy().replace('\\', "/");
                            if path_str.contains("node_modules")
                                || path_str.contains("/.git/")
                                || path_str.contains("/target/")
                                || path_str.contains("/dist/")
                                || path_str.contains("/.forge/changesets/")
                            {
                                continue;
                            }

                            let rel_path = path_str.strip_prefix(&root_str_clone)
                                .unwrap_or(&path_str)
                                .trim_start_matches('/')
                                .to_string();

                            if rel_path.is_empty() {
                                continue;
                            }

                            let is_delete = matches!(ev.kind, EventKind::Remove(_));
                            pending.insert(rel_path, (ev.path_buf, Instant::now(), is_delete));
                        }
                        None => break, // Channel closed
                    }
                }
                _ = tokio::time::sleep(Duration::from_millis(50)) => {
                    let now = Instant::now();
                    let mut ready_keys = Vec::new();
                    for (rel, (_, timestamp, _)) in &pending {
                        if now.duration_since(*timestamp) >= debounce_duration {
                            ready_keys.push(rel.clone());
                        }
                    }

                    for rel in ready_keys {
                        if let Some((path_buf, _, is_delete)) = pending.remove(&rel) {
                            if is_delete || !path_buf.exists() {
                                crate::services::incremental::on_file_deleted(&root_str_clone, &rel, &db_clone);
                            } else if path_buf.is_file() {
                                if let Ok(content) = std::fs::read_to_string(&path_buf) {
                                    crate::services::incremental::on_file_changed(&root_str_clone, &rel, &content, &db_clone);
                                }
                            }
                        }
                    }
                }
            }
        }
    });

    let tx_clone = tx.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            for path in event.paths {
                let _ = tx_clone.send(WatchEvent {
                    path_buf: path,
                    kind: event.kind,
                });
            }
        }
    }).map_err(|e| format!("Failed to create filesystem watcher: {e}"))?;

    if Path::new(clean_path).exists() {
        watcher.watch(Path::new(clean_path), RecursiveMode::Recursive)
            .map_err(|e| format!("Failed to watch directory: {e}"))?;
        state._watcher = Some(watcher);
        state.active_path = Some(clean_path.to_string());
        state._event_tx = Some(tx);
    }

    Ok(())
}
