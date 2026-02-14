use std::path::Path;

use crate::core::localhost_runtime::{
    LocalhostPortMode, LocalhostRuntime, LocalhostSessionSpec, LocalhostSessionType,
    LocalhostSessionView, SharedLocalhostRuntime,
};

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalhostListArgs {
    pub project_path: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalhostUpsertArgs {
    pub spec: LocalhostSessionSpecInput,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalhostDeleteArgs {
    pub project_path: String,
    pub id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalhostIdArgs {
    pub project_path: String,
    pub id: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalhostSessionSpecInput {
    pub id: Option<String>,
    pub project_path: String,
    pub working_dir: String,
    pub source_label: String,
    pub r#type: LocalhostSessionType,
    pub port_mode: LocalhostPortMode,
    pub preferred_port: Option<u16>,
    pub auto_install_deps: bool,
}

impl From<LocalhostSessionSpecInput> for LocalhostSessionSpec {
    fn from(v: LocalhostSessionSpecInput) -> Self {
        Self {
            id: v.id.unwrap_or_default(),
            project_path: v.project_path,
            working_dir: v.working_dir,
            source_label: v.source_label,
            r#type: v.r#type,
            port_mode: v.port_mode,
            preferred_port: v.preferred_port,
            auto_install_deps: v.auto_install_deps,
            created_at: None,
        }
    }
}

#[tauri::command]
pub fn localhost_session_list(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, SharedLocalhostRuntime>,
    args: LocalhostListArgs,
) -> std::result::Result<Vec<LocalhostSessionView>, String> {
    let project_path = Path::new(&args.project_path);
    let guard = runtime
        .inner()
        .lock()
        .map_err(|_| "mutex poisoned".to_string())?;
    guard.list(&app, project_path).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn localhost_session_upsert(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, SharedLocalhostRuntime>,
    args: LocalhostUpsertArgs,
) -> std::result::Result<Vec<LocalhostSessionView>, String> {
    let mut spec: LocalhostSessionSpec = args.spec.into();
    // Normalize paths to reduce "same folder, different string" mismatches.
    spec.project_path = spec.project_path.trim_end_matches(['/', '\\']).to_string();
    spec.working_dir = spec.working_dir.trim_end_matches(['/', '\\']).to_string();
    if spec.project_path.trim().is_empty() {
        return Err("missing projectPath".to_string());
    }
    let project_path_str = spec.project_path.clone();
    let project_path = Path::new(&project_path_str);

    let mut guard = runtime
        .inner()
        .lock()
        .map_err(|_| "mutex poisoned".to_string())?;
    guard
        .upsert_spec(&app, spec)
        .and_then(|_| guard.list(&app, project_path))
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn localhost_session_delete(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, SharedLocalhostRuntime>,
    args: LocalhostDeleteArgs,
) -> std::result::Result<Vec<LocalhostSessionView>, String> {
    let project_path = Path::new(&args.project_path);
    let mut guard = runtime
        .inner()
        .lock()
        .map_err(|_| "mutex poisoned".to_string())?;

    // Best-effort: stop if running.
    let _ = guard.stop(app.clone(), &args.project_path, &args.id);

    guard
        .delete_spec(&app, project_path, &args.id)
        .and_then(|_| guard.list(&app, project_path))
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn localhost_session_start(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, SharedLocalhostRuntime>,
    args: LocalhostIdArgs,
) -> std::result::Result<LocalhostSessionView, String> {
    let project_path = Path::new(&args.project_path);
    let spec = {
        let guard = runtime
            .inner()
            .lock()
            .map_err(|_| "mutex poisoned".to_string())?;
        guard
            .get_spec(&app, project_path, &args.id)
            .map_err(|e| format!("{e:#}"))?
    };
    let Some(spec) = spec else {
        return Err(format!("unknown localhost session id {}", args.id));
    };

    LocalhostRuntime::start_with_runtime(runtime.inner().clone(), app, spec)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn localhost_session_stop(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, SharedLocalhostRuntime>,
    args: LocalhostIdArgs,
) -> std::result::Result<LocalhostSessionView, String> {
    let project_path = Path::new(&args.project_path);
    let spec = {
        let guard = runtime
            .inner()
            .lock()
            .map_err(|_| "mutex poisoned".to_string())?;
        guard
            .get_spec(&app, project_path, &args.id)
            .map_err(|e| format!("{e:#}"))?
    };
    let Some(spec) = spec else {
        return Err(format!("unknown localhost session id {}", args.id));
    };

    {
        let mut guard = runtime
            .inner()
            .lock()
            .map_err(|_| "mutex poisoned".to_string())?;
        guard
            .stop(app.clone(), &args.project_path, &args.id)
            .map_err(|e| format!("{e:#}"))?;
    }

    Ok(LocalhostSessionView {
        spec,
        status: crate::core::localhost_runtime::LocalhostSessionStatus::Stopped,
        port: None,
        pid: None,
        url: None,
        last_exit_code: None,
        cmdline: None,
    })
}

#[tauri::command]
pub fn localhost_session_restart(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, SharedLocalhostRuntime>,
    args: LocalhostIdArgs,
) -> std::result::Result<LocalhostSessionView, String> {
    // Stop is best-effort.
    {
        let mut guard = runtime
            .inner()
            .lock()
            .map_err(|_| "mutex poisoned".to_string())?;
        let _ = guard.stop(app.clone(), &args.project_path, &args.id);
    }
    localhost_session_start(app, runtime, args)
}

#[tauri::command]
pub fn localhost_session_logs(
    _app: tauri::AppHandle,
    runtime: tauri::State<'_, SharedLocalhostRuntime>,
    args: LocalhostIdArgs,
) -> std::result::Result<Vec<String>, String> {
    let guard = runtime
        .inner()
        .lock()
        .map_err(|_| "mutex poisoned".to_string())?;
    Ok(guard.logs(&args.project_path, &args.id))
}
