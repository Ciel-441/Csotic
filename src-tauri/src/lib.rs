mod ipc;
mod services;
mod ollama;
mod tools;
mod db;
mod events;
pub mod agents;

use std::sync::{Arc, Mutex};
use tauri::Manager;
use rusqlite::Connection;
use services::terminal::ProcessHandle;
use ipc::commands::ipc_request;

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
                std::env::current_dir().unwrap().join("data")
            });
            std::fs::create_dir_all(&app_dir).ok();
            let db_path = app_dir.join("forge.db");
            let conn = db::init_db(&db_path).expect("failed to initialize sqlite database");
            
            app.manage(AppState {
                db: Arc::new(Mutex::new(conn)),
                process_handle: std::sync::Arc::new(tokio::sync::Mutex::new(None)),
                active_project_path: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![ipc_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
