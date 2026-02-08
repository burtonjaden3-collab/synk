mod commands;
mod core;
mod events;

use crate::commands::agents::agents_list;
use crate::commands::git::{
    git_branches, git_cleanup_orphans, git_create_worktree, git_delete_worktree,
    git_detect_orphans, git_list_worktrees, git_remove_worktree,
};
use crate::commands::mcp::{mcp_discover, mcp_set_enabled};
use crate::commands::onboarding::{
    onboarding_initialize, onboarding_is_first_run, onboarding_scan,
};
use crate::commands::persistence::{list_recent_projects, open_project};
use crate::commands::persistence::{
    project_config_get, project_session_config_get, project_session_config_set,
};
use crate::commands::persistence::{
    session_snapshot_autosave_meta, session_snapshot_list, session_snapshot_load,
    session_snapshot_save_autosave, session_snapshot_save_named,
};
use crate::commands::review::{
    git_diff, git_merge, review_add_comment, review_create, review_get, review_list,
    review_resolve_comment, review_set_decision, review_set_merge_strategy, review_set_status,
};
use crate::commands::session::{
    session_create, session_destroy, session_list, session_resize, session_scrollback,
    session_write,
};
use crate::commands::settings::{
    settings_get, settings_list_provider_models, settings_set, settings_validate_provider_key,
};
use crate::commands::skills::{skills_discover, skills_set_enabled};
use crate::core::agent_detection::{AgentRegistry, SharedAgentRegistry};
use crate::core::git_events::{GitEventWatcher, SharedGitEventWatcher};
use crate::core::mcp_server::{McpRuntime, SharedMcpRuntime};
use crate::core::process_pool::{PoolConfig, ProcessPool, SharedProcessPool};
use crate::core::session_manager::{SessionManager, SharedSessionManager};
use crate::core::settings as core_settings;
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

    let agents: SharedAgentRegistry =
        std::sync::Arc::new(std::sync::Mutex::new(AgentRegistry::detect()));

    let mcp_runtime: SharedMcpRuntime =
        std::sync::Arc::new(std::sync::Mutex::new(McpRuntime::default()));

    let session_manager: SharedSessionManager = std::sync::Arc::new(std::sync::Mutex::new(
        SessionManager::new(pool.clone(), agents.clone()),
    ));

    let git_watcher: SharedGitEventWatcher =
        std::sync::Arc::new(std::sync::Mutex::new(GitEventWatcher::new()));
    let git_watcher_setup = git_watcher.clone();
    let session_manager_setup = session_manager.clone();

    let app = tauri::Builder::default()
        .manage(pool.clone())
        .manage(agents)
        .manage(mcp_runtime.clone())
        .manage(session_manager)
        .manage(git_watcher)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            GitEventWatcher::start(
                git_watcher_setup.clone(),
                app.handle().clone(),
                session_manager_setup.clone(),
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            debug_pool_stats,
            debug_pool_roundtrip,
            agents_list,
            onboarding_is_first_run,
            onboarding_initialize,
            onboarding_scan,
            list_recent_projects,
            open_project,
            project_config_get,
            project_session_config_get,
            project_session_config_set,
            session_snapshot_save_named,
            session_snapshot_save_autosave,
            session_snapshot_list,
            session_snapshot_load,
            session_snapshot_autosave_meta,
            settings_get,
            settings_set,
            settings_validate_provider_key,
            settings_list_provider_models,
            skills_discover,
            skills_set_enabled,
            mcp_discover,
            mcp_set_enabled,
            git_create_worktree,
            git_remove_worktree,
            git_delete_worktree,
            git_list_worktrees,
            git_detect_orphans,
            git_cleanup_orphans,
            git_branches,
            git_diff,
            git_merge,
            review_create,
            review_list,
            review_get,
            review_set_status,
            review_set_decision,
            review_set_merge_strategy,
            review_add_comment,
            review_resolve_comment,
            session_create,
            session_destroy,
            session_write,
            session_resize,
            session_scrollback,
            session_list
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Load settings and apply pool config before warmup so warmup uses the user's config.
    if let Ok(settings) = core_settings::settings_get(&app.handle()) {
        let cfg = core_settings::pool_config_from_settings(&settings);
        ProcessPool::reconfigure(pool.clone(), cfg);
    }
    ProcessPool::warmup_in_background(pool.clone());

    // Ensure we tear down child processes on exit (especially important during dev).
    let did_shutdown = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let did_shutdown_2 = did_shutdown.clone();
    app.run(move |app_handle, event| {
        let should_shutdown = matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        );
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

        if let Ok(mut rt) = app_handle
            .state::<SharedMcpRuntime>()
            .inner()
            .as_ref()
            .try_lock()
        {
            rt.shutdown_all();
        }

        if let Ok(mut gw) = app_handle
            .state::<SharedGitEventWatcher>()
            .inner()
            .as_ref()
            .try_lock()
        {
            gw.shutdown();
        }
    });
}
