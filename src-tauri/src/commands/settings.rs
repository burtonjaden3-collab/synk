use tauri::State;

use crate::core::process_pool::{PoolConfig, ProcessPool, SharedProcessPool};
use crate::core::settings::{
    OllamaPullResult, ProviderKeyValidationResult, ProviderModelsResult, SettingsView,
};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSetArgs {
    pub settings: SettingsView,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderValidateArgs {
    pub provider: String,
    pub api_key: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelsArgs {
    pub provider: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaPullArgs {
    pub model: String,
    pub base_url: Option<String>,
}

#[tauri::command]
pub fn settings_get(app: tauri::AppHandle) -> std::result::Result<SettingsView, String> {
    crate::core::settings::settings_get(&app).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn settings_set(
    app: tauri::AppHandle,
    pool: State<'_, SharedProcessPool>,
    args: SettingsSetArgs,
) -> std::result::Result<SettingsView, String> {
    let view =
        crate::core::settings::settings_set(&app, args.settings).map_err(|e| format!("{e:#}"))?;

    // Apply performance settings immediately (best-effort). This updates limits for new sessions
    // and changes how the pool refills. Existing sessions are not affected.
    let cfg: PoolConfig = crate::core::settings::pool_config_from_settings(&view);
    ProcessPool::reconfigure(pool.inner().clone(), cfg);

    Ok(view)
}

#[tauri::command]
pub fn settings_validate_provider_key(
    args: ProviderValidateArgs,
) -> std::result::Result<ProviderKeyValidationResult, String> {
    crate::core::settings::validate_provider_key(&args.provider, &args.api_key)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn settings_list_provider_models(
    args: ProviderModelsArgs,
) -> std::result::Result<ProviderModelsResult, String> {
    crate::core::settings::list_provider_models(
        &args.provider,
        args.api_key.as_deref().unwrap_or(""),
        args.base_url.as_deref(),
    )
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn settings_ollama_pull_model(
    args: OllamaPullArgs,
) -> std::result::Result<OllamaPullResult, String> {
    crate::core::settings::pull_ollama_model(&args.model, args.base_url.as_deref())
        .map_err(|e| format!("{e:#}"))
}
