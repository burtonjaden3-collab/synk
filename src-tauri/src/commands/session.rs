use tauri::State;

use crate::core::session_manager::{
    CreateSessionArgs, CreateSessionResponse, SessionInfo, SharedSessionManager,
};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionIdArgs {
    pub session_id: usize,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionWriteArgs {
    pub session_id: usize,
    pub data: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResizeArgs {
    pub session_id: usize,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestroySessionResponse {
    pub success: bool,
}

#[tauri::command]
pub fn session_create(
    app: tauri::AppHandle,
    manager: State<'_, SharedSessionManager>,
    args: CreateSessionArgs,
) -> std::result::Result<CreateSessionResponse, String> {
    let mut guard = manager.lock().expect("session manager mutex poisoned");
    guard
        .create_session(app, args)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn session_destroy(
    app: tauri::AppHandle,
    manager: State<'_, SharedSessionManager>,
    args: SessionIdArgs,
) -> std::result::Result<DestroySessionResponse, String> {
    let mut guard = manager.lock().expect("session manager mutex poisoned");
    guard
        .destroy_session(app, args.session_id)
        .map(|_| DestroySessionResponse { success: true })
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn session_write(
    manager: State<'_, SharedSessionManager>,
    args: SessionWriteArgs,
) -> std::result::Result<(), String> {
    let mut guard = manager.lock().expect("session manager mutex poisoned");
    guard
        .write(args.session_id, &args.data)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn session_resize(
    manager: State<'_, SharedSessionManager>,
    args: SessionResizeArgs,
) -> std::result::Result<(), String> {
    let mut guard = manager.lock().expect("session manager mutex poisoned");
    guard
        .resize(args.session_id, args.cols, args.rows)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn session_list(
    manager: State<'_, SharedSessionManager>,
) -> std::result::Result<Vec<SessionInfo>, String> {
    let guard = manager.lock().expect("session manager mutex poisoned");
    Ok(guard.list_sessions())
}
