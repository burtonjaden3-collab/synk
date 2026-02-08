use std::path::PathBuf;

use tauri::State;

use crate::core::agent_detection::AgentType;
use crate::core::persistence::{
    ProjectConfigView, RecentProject, SessionConfigDisk, SessionConfigView, SessionSnapshot,
    SessionSnapshotMeta,
};
use crate::core::session_manager::SharedSessionManager;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectArgs {
    pub path: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfigGetArgs {
    pub project_path: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionConfigGetArgs {
    pub project_path: String,
    pub session_id: usize,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionConfigSetArgs {
    pub project_path: String,
    pub session_id: usize,
    pub agent_type: Option<AgentType>,
    pub branch: Option<String>,
    pub worktree_isolation: Option<bool>,
    pub skills: Vec<String>,
    pub mcp_servers: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshotSaveNamedArgs {
    pub project_path: String,
    pub name: String,
    pub orchestration_mode: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshotSaveAutosaveArgs {
    pub project_path: String,
    pub orchestration_mode: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshotListArgs {
    #[serde(default)]
    pub project_path: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshotLoadArgs {
    pub id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshotAutosaveMetaArgs {
    pub project_path: String,
}

#[tauri::command]
pub fn list_recent_projects(
    app: tauri::AppHandle,
) -> std::result::Result<Vec<RecentProject>, String> {
    crate::core::persistence::list_recent_projects(&app).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn open_project(
    app: tauri::AppHandle,
    args: OpenProjectArgs,
) -> std::result::Result<RecentProject, String> {
    let path = PathBuf::from(args.path);
    crate::core::persistence::open_project(&app, &path).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn project_config_get(
    args: ProjectConfigGetArgs,
) -> std::result::Result<ProjectConfigView, String> {
    let path = PathBuf::from(args.project_path);
    crate::core::persistence::project_config_get(&path).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn project_session_config_get(
    args: ProjectSessionConfigGetArgs,
) -> std::result::Result<Option<SessionConfigView>, String> {
    let path = PathBuf::from(args.project_path);
    crate::core::persistence::project_session_config_get(&path, args.session_id)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn project_session_config_set(
    args: ProjectSessionConfigSetArgs,
) -> std::result::Result<(), String> {
    let path = PathBuf::from(args.project_path);
    let cfg = SessionConfigDisk {
        agent_type: args.agent_type,
        branch: args.branch,
        worktree_isolation: args.worktree_isolation,
        skills: args.skills,
        mcp_servers: args.mcp_servers,
    };
    crate::core::persistence::project_session_config_set(&path, args.session_id, cfg)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn session_snapshot_save_named(
    app: tauri::AppHandle,
    manager: State<'_, SharedSessionManager>,
    args: SessionSnapshotSaveNamedArgs,
) -> std::result::Result<SessionSnapshotMeta, String> {
    let project_path = PathBuf::from(&args.project_path);
    let guard = manager.lock().expect("session manager mutex poisoned");
    let sessions: Vec<_> = guard
        .list_sessions()
        .into_iter()
        .filter(|s| s.project_path == args.project_path)
        .collect();
    crate::core::persistence::session_snapshot_save_named(
        &app,
        &project_path,
        &args.name,
        &args.orchestration_mode,
        sessions,
    )
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn session_snapshot_save_autosave(
    app: tauri::AppHandle,
    manager: State<'_, SharedSessionManager>,
    args: SessionSnapshotSaveAutosaveArgs,
) -> std::result::Result<SessionSnapshotMeta, String> {
    let project_path = PathBuf::from(&args.project_path);
    let guard = manager.lock().expect("session manager mutex poisoned");
    let sessions: Vec<_> = guard
        .list_sessions()
        .into_iter()
        .filter(|s| s.project_path == args.project_path)
        .collect();
    crate::core::persistence::session_snapshot_save_autosave(
        &app,
        &project_path,
        &args.orchestration_mode,
        sessions,
    )
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn session_snapshot_list(
    app: tauri::AppHandle,
    args: SessionSnapshotListArgs,
) -> std::result::Result<Vec<SessionSnapshotMeta>, String> {
    let project_path = args.project_path.map(PathBuf::from);
    crate::core::persistence::session_snapshot_list(
        &app,
        project_path.as_ref().map(|p| p.as_path()),
    )
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn session_snapshot_load(
    app: tauri::AppHandle,
    args: SessionSnapshotLoadArgs,
) -> std::result::Result<SessionSnapshot, String> {
    crate::core::persistence::session_snapshot_load(&app, &args.id).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn session_snapshot_autosave_meta(
    app: tauri::AppHandle,
    args: SessionSnapshotAutosaveMetaArgs,
) -> std::result::Result<Option<SessionSnapshotMeta>, String> {
    let project_path = PathBuf::from(&args.project_path);
    crate::core::persistence::session_snapshot_autosave_meta(&app, &project_path)
        .map_err(|e| format!("{e:#}"))
}
