#![warn(clippy::unwrap_used)]
#![allow(clippy::too_many_arguments, clippy::upper_case_acronyms)]

mod db;
mod events;
mod ipc;
mod ollama;
mod services;
mod tools;

use ipc::commands::ipc_request;
use rusqlite::Connection;
use services::terminal::ProcessHandle;
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub process_handle: ProcessHandle,
    pub active_project_path: Mutex<Option<String>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_dir = app.path().app_data_dir().unwrap_or_else(|_| {
                std::env::current_dir()
                    .unwrap_or_else(|_| std::path::PathBuf::from("."))
                    .join("data")
            });
            std::fs::create_dir_all(&app_dir).ok();
            let db_path = app_dir.join("forge.db");
            let conn = db::init_db(&db_path).expect("failed to initialize sqlite database");

            app.manage(AppState {
                db: Arc::new(Mutex::new(conn)),
                process_handle: std::sync::Arc::new(tokio::sync::Mutex::new(None)),
                active_project_path: Mutex::new(None),
            });

            // Windows Memory Trimmer: Run after startup and periodically during idle
            #[cfg(target_os = "windows")]
            {
                tauri::async_runtime::spawn(async {
                    // Wait 2.5s for initial window render, fonts, and scripts to finish loading
                    tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
                    services::system::trim_process_memory();

                    // Periodic memory compaction every 5 minutes
                    let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
                    loop {
                        interval.tick().await;
                        services::system::trim_process_memory();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ipc_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
