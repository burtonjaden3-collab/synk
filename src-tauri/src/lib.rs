mod commands;
mod core;
mod events;

use crate::commands::session::{
    session_create, session_destroy, session_list, session_resize, session_write,
};
use crate::core::process_pool::{PoolConfig, ProcessPool, SharedProcessPool};
use crate::core::session_manager::{SessionManager, SharedSessionManager};

#[tauri::command]
fn debug_pool_stats(pool: tauri::State<'_, SharedProcessPool>) -> core::process_pool::PoolStats {
    let guard = pool.inner().lock().expect("pool mutex poisoned");
    guard.stats()
}

#[tauri::command]
fn debug_pool_roundtrip(pool: tauri::State<'_, SharedProcessPool>) -> Result<String, String> {
    ProcessPool::debug_roundtrip(pool.inner().clone()).map_err(|e| format!("{e:#}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pool: SharedProcessPool = std::sync::Arc::new(std::sync::Mutex::new(ProcessPool::new(
        PoolConfig::default(),
    )));
    ProcessPool::warmup_in_background(pool.clone());

    let session_manager: SharedSessionManager =
        std::sync::Arc::new(std::sync::Mutex::new(SessionManager::new(pool.clone())));

    tauri::Builder::default()
        .manage(pool)
        .manage(session_manager)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            debug_pool_stats,
            debug_pool_roundtrip,
            session_create,
            session_destroy,
            session_write,
            session_resize,
            session_list
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
