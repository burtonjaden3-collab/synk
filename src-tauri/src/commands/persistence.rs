use std::path::PathBuf;

use crate::core::persistence::RecentProject;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectArgs {
    pub path: String,
}

#[tauri::command]
pub fn list_recent_projects(app: tauri::AppHandle) -> std::result::Result<Vec<RecentProject>, String> {
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
