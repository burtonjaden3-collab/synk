mod commands;
mod core;
mod events;

use crate::core::agent_detection::{AgentRegistry, SharedAgentRegistry};
use crate::commands::session::{
    session_create, session_destroy, session_list, session_resize, session_write,
};
use crate::commands::persistence::{list_recent_projects, open_project};
use crate::core::process_pool::{PoolConfig, ProcessPool, SharedProcessPool};
use crate::core::session_manager::{SessionManager, SharedSessionManager};
use crate::commands::agents::agents_list;
use tauri::Manager;

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

    let agents: SharedAgentRegistry =
        std::sync::Arc::new(std::sync::Mutex::new(AgentRegistry::detect()));

    let session_manager: SharedSessionManager =
        std::sync::Arc::new(std::sync::Mutex::new(SessionManager::new(
            pool.clone(),
            agents.clone(),
        )));

    let app = tauri::Builder::default()
        .manage(pool)
        .manage(agents)
        .manage(session_manager)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            debug_pool_stats,
            debug_pool_roundtrip,
            agents_list,
            list_recent_projects,
            open_project,
            session_create,
            session_destroy,
            session_write,
            session_resize,
            session_list
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Ensure we tear down child processes on exit (especially important during dev).
    let did_shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let did_shutdown_2 = did_shutdown.clone();
    app.run(move |app_handle, event| {
        let should_shutdown = matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit);
        if !should_shutdown {
            return;
        }
        if did_shutdown_2.swap(true, std::sync::atomic::Ordering::SeqCst) {
            return;
        }

        if let Ok(mut mgr) = app_handle
            .state::<SharedSessionManager>()
            .inner()
            .as_ref()
            .try_lock()
        {
            mgr.shutdown();
        }

        let pool = app_handle.state::<SharedProcessPool>().inner().clone();
        let _ = ProcessPool::shutdown(pool);
    });
}
