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

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCdArgs {
    pub session_id: usize,
    pub dir: String,
    #[serde(default)]
    pub branch: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRestartArgs {
    pub session_id: usize,
    pub dir: String,
    #[serde(default)]
    pub branch: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestroySessionResponse {
    pub success: bool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionScrollbackResponse {
    pub data_b64: String,
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

fn shell_single_quote_escape(s: &str) -> String {
    // Bash-safe single-quote escaping: ' -> '\''.
    s.replace('\'', "'\\''")
}

#[tauri::command]
pub fn session_cd(
    manager: State<'_, SharedSessionManager>,
    args: SessionCdArgs,
) -> std::result::Result<(), String> {
    let dir = args.dir.trim();
    if dir.is_empty() {
        return Err("dir is empty".to_string());
    }

    let cd_cmd = format!("cd '{}'\r\n", shell_single_quote_escape(dir));

    let mut guard = manager.lock().expect("session manager mutex poisoned");
    guard.write(args.session_id, &cd_cmd).map_err(|e| format!("{e:#}"))?;
    guard
        .set_session_git_context(args.session_id, args.branch, Some(dir.to_string()))
        .map_err(|e| format!("{e:#}"))?;
    Ok(())
}

#[tauri::command]
pub fn session_restart(
    app: tauri::AppHandle,
    manager: State<'_, SharedSessionManager>,
    args: SessionRestartArgs,
) -> std::result::Result<SessionInfo, String> {
    let mut guard = manager.lock().expect("session manager mutex poisoned");
    guard
        .restart_session(app, args.session_id, args.dir, args.branch, args.model)
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

#[tauri::command]
pub fn session_scrollback(
    manager: State<'_, SharedSessionManager>,
    args: SessionIdArgs,
) -> std::result::Result<SessionScrollbackResponse, String> {
    let guard = manager.lock().expect("session manager mutex poisoned");
    let data_b64 = guard
        .scrollback_b64(args.session_id)
        .map_err(|e| format!("{e:#}"))?;
    Ok(SessionScrollbackResponse { data_b64 })
}
