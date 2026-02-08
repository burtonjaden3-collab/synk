use std::fs;
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::Manager;

use crate::core::process_pool::PoolConfig;

// -----------------------------------------------------------------------------
// Disk schema (snake_case) matches `~/.config/synk/settings.json` spec.
// View schema (camelCase) is what the frontend uses over IPC.
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthModeDisk {
    ApiKey,
    Oauth,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AuthModeView {
    ApiKey,
    Oauth,
}

impl From<AuthModeDisk> for AuthModeView {
    fn from(v: AuthModeDisk) -> Self {
        match v {
            AuthModeDisk::ApiKey => AuthModeView::ApiKey,
            AuthModeDisk::Oauth => AuthModeView::Oauth,
        }
    }
}

impl From<AuthModeView> for AuthModeDisk {
    fn from(v: AuthModeView) -> Self {
        match v {
            AuthModeView::ApiKey => AuthModeDisk::ApiKey,
            AuthModeView::Oauth => AuthModeDisk::Oauth,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct ProviderAuthDisk {
    pub auth_mode: Option<AuthModeDisk>,
    pub api_key: Option<String>,
    pub oauth_connected: bool,
    pub oauth_email: Option<String>,
    pub default_model: String,
}

impl Default for ProviderAuthDisk {
    fn default() -> Self {
        Self {
            auth_mode: None,
            api_key: None,
            oauth_connected: false,
            oauth_email: None,
            default_model: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct OllamaDisk {
    pub base_url: String,
    pub default_model: String,
}

impl Default for OllamaDisk {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:11434".to_string(),
            default_model: "llama3.1".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct AiProvidersDisk {
    pub default: String,
    pub anthropic: ProviderAuthDisk,
    pub google: ProviderAuthDisk,
    pub openai: ProviderAuthDisk,
    pub ollama: OllamaDisk,
}

impl Default for AiProvidersDisk {
    fn default() -> Self {
        Self {
            default: "anthropic".to_string(),
            anthropic: ProviderAuthDisk {
                auth_mode: Some(AuthModeDisk::Oauth),
                api_key: None,
                oauth_connected: false,
                oauth_email: None,
                default_model: "claude-sonnet-4-5-20250929".to_string(),
            },
            google: ProviderAuthDisk {
                auth_mode: Some(AuthModeDisk::ApiKey),
                api_key: None,
                oauth_connected: false,
                oauth_email: None,
                default_model: "gemini-2.0-flash".to_string(),
            },
            openai: ProviderAuthDisk {
                auth_mode: None,
                api_key: None,
                oauth_connected: false,
                oauth_email: None,
                // Used for Codex panes today (Codex CLI) and as the OpenAI default generally.
                default_model: "gpt-5.3-codex".to_string(),
            },
            ollama: OllamaDisk::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct PerformanceDisk {
    pub initial_pool_size: usize,
    pub max_pool_size: usize,
    pub max_active_sessions: usize,
    pub recycle_enabled: bool,
    pub max_pty_age_minutes: u64,
    pub warmup_delay_ms: u64,
    pub poll_interval_ms: u64,
}

impl Default for PerformanceDisk {
    fn default() -> Self {
        Self {
            initial_pool_size: 2,
            max_pool_size: 4,
            max_active_sessions: 12,
            recycle_enabled: true,
            max_pty_age_minutes: 30,
            warmup_delay_ms: 100,
            poll_interval_ms: 5000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct KeyboardDisk {
    pub terminal_exit_method: String, // "double_escape" | "ctrl_backslash" | "ctrl_shift_escape"
    pub double_escape_timeout_ms: u64,
    pub custom_bindings: serde_json::Value,
}

impl Default for KeyboardDisk {
    fn default() -> Self {
        Self {
            terminal_exit_method: "double_escape".to_string(),
            double_escape_timeout_ms: 300,
            custom_bindings: serde_json::Value::Object(Default::default()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct UiDisk {
    pub sidebar_width: u32,
    pub drawer_height: u32,
    pub drawer_panel_order: Vec<String>,
    pub show_session_cost_in_header: bool,
    pub dim_unfocused_panes: bool,
    pub unfocused_opacity: f32,
}

impl Default for UiDisk {
    fn default() -> Self {
        Self {
            sidebar_width: 280,
            drawer_height: 250,
            drawer_panel_order: vec![
                "cost".to_string(),
                "git".to_string(),
                "tasks".to_string(),
                "reviews".to_string(),
            ],
            show_session_cost_in_header: true,
            dim_unfocused_panes: true,
            unfocused_opacity: 0.7,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct NotificationsDisk {
    pub task_completed: bool,
    pub agent_error: bool,
    pub merge_conflict: bool,
    pub review_ready: bool,
    pub cost_threshold: Option<f32>,
    pub position: String,
    pub duration_ms: u64,
}

impl Default for NotificationsDisk {
    fn default() -> Self {
        Self {
            task_completed: true,
            agent_error: true,
            merge_conflict: true,
            review_ready: true,
            cost_threshold: None,
            position: "top-right".to_string(),
            duration_ms: 5000,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct GitDisk {
    pub default_merge_strategy: String,
    pub auto_delegate_conflicts: bool,
    pub worktree_base_path: String,
    pub branch_prefix: String,
}

impl Default for GitDisk {
    fn default() -> Self {
        Self {
            default_merge_strategy: "squash".to_string(),
            auto_delegate_conflicts: true,
            worktree_base_path: "~/.synk/worktrees".to_string(),
            branch_prefix: "feat/".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct SessionDisk {
    pub auto_save: bool,
    pub auto_save_interval_seconds: u64,
}

impl Default for SessionDisk {
    fn default() -> Self {
        Self {
            auto_save: true,
            auto_save_interval_seconds: 60,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct GastownDisk {
    pub cli_path: Option<String>,
    pub workspace_path: String,
    pub pinned_version: String,
}

impl Default for GastownDisk {
    fn default() -> Self {
        Self {
            cli_path: None,
            workspace_path: "~/gt/".to_string(),
            pinned_version: "0.3.x".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", default)]
pub struct SettingsDisk {
    pub version: u32,
    pub ai_providers: AiProvidersDisk,
    pub performance: PerformanceDisk,
    pub keyboard: KeyboardDisk,
    pub ui: UiDisk,
    pub notifications: NotificationsDisk,
    pub git: GitDisk,
    pub session: SessionDisk,
    pub gastown: GastownDisk,
}

impl Default for SettingsDisk {
    fn default() -> Self {
        Self {
            version: 2,
            ai_providers: AiProvidersDisk::default(),
            performance: PerformanceDisk::default(),
            keyboard: KeyboardDisk::default(),
            ui: UiDisk::default(),
            notifications: NotificationsDisk::default(),
            git: GitDisk::default(),
            session: SessionDisk::default(),
            gastown: GastownDisk::default(),
        }
    }
}

// -----------------------------------------------------------------------------
// View schema (camelCase) for the frontend
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderAuthView {
    pub auth_mode: Option<AuthModeView>,
    pub api_key: Option<String>,
    pub oauth_connected: bool,
    pub oauth_email: Option<String>,
    pub default_model: String,
}

impl Default for ProviderAuthView {
    fn default() -> Self {
        Self {
            auth_mode: None,
            api_key: None,
            oauth_connected: false,
            oauth_email: None,
            default_model: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OllamaView {
    pub base_url: String,
    pub default_model: String,
}

impl Default for OllamaView {
    fn default() -> Self {
        Self {
            base_url: "http://localhost:11434".to_string(),
            default_model: "llama3.1".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiProvidersView {
    pub default: String,
    pub anthropic: ProviderAuthView,
    pub google: ProviderAuthView,
    pub openai: ProviderAuthView,
    pub ollama: OllamaView,
}

impl Default for AiProvidersView {
    fn default() -> Self {
        AiProvidersDisk::default().into()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PerformanceView {
    pub initial_pool_size: usize,
    pub max_pool_size: usize,
    pub max_active_sessions: usize,
    pub recycle_enabled: bool,
    pub max_pty_age_minutes: u64,
    pub warmup_delay_ms: u64,
    pub poll_interval_ms: u64,
}

impl Default for PerformanceView {
    fn default() -> Self {
        PerformanceDisk::default().into()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct KeyboardView {
    pub terminal_exit_method: String,
    pub double_escape_timeout_ms: u64,
    pub custom_bindings: serde_json::Value,
}

impl Default for KeyboardView {
    fn default() -> Self {
        KeyboardDisk::default().into()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UiView {
    pub sidebar_width: u32,
    pub drawer_height: u32,
    pub drawer_panel_order: Vec<String>,
    pub show_session_cost_in_header: bool,
    pub dim_unfocused_panes: bool,
    pub unfocused_opacity: f32,
}

impl Default for UiView {
    fn default() -> Self {
        UiDisk::default().into()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NotificationsView {
    pub task_completed: bool,
    pub agent_error: bool,
    pub merge_conflict: bool,
    pub review_ready: bool,
    pub cost_threshold: Option<f32>,
    pub position: String,
    pub duration_ms: u64,
}

impl Default for NotificationsView {
    fn default() -> Self {
        NotificationsDisk::default().into()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GitView {
    pub default_merge_strategy: String,
    pub auto_delegate_conflicts: bool,
    pub worktree_base_path: String,
    pub branch_prefix: String,
}

impl Default for GitView {
    fn default() -> Self {
        GitDisk::default().into()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SessionView {
    pub auto_save: bool,
    pub auto_save_interval_seconds: u64,
}

impl Default for SessionView {
    fn default() -> Self {
        SessionDisk::default().into()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GastownView {
    pub cli_path: Option<String>,
    pub workspace_path: String,
    pub pinned_version: String,
}

impl Default for GastownView {
    fn default() -> Self {
        GastownDisk::default().into()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SettingsView {
    pub version: u32,
    pub ai_providers: AiProvidersView,
    pub performance: PerformanceView,
    pub keyboard: KeyboardView,
    pub ui: UiView,
    pub notifications: NotificationsView,
    pub git: GitView,
    pub session: SessionView,
    pub gastown: GastownView,
}

impl Default for SettingsView {
    fn default() -> Self {
        SettingsDisk::default().into()
    }
}

impl From<ProviderAuthDisk> for ProviderAuthView {
    fn from(v: ProviderAuthDisk) -> Self {
        Self {
            auth_mode: v.auth_mode.map(AuthModeView::from),
            api_key: v.api_key,
            oauth_connected: v.oauth_connected,
            oauth_email: v.oauth_email,
            default_model: v.default_model,
        }
    }
}

impl From<ProviderAuthView> for ProviderAuthDisk {
    fn from(v: ProviderAuthView) -> Self {
        Self {
            auth_mode: v.auth_mode.map(AuthModeDisk::from),
            api_key: v.api_key,
            oauth_connected: v.oauth_connected,
            oauth_email: v.oauth_email,
            default_model: v.default_model,
        }
    }
}

impl From<OllamaDisk> for OllamaView {
    fn from(v: OllamaDisk) -> Self {
        Self {
            base_url: v.base_url,
            default_model: v.default_model,
        }
    }
}

impl From<OllamaView> for OllamaDisk {
    fn from(v: OllamaView) -> Self {
        Self {
            base_url: v.base_url,
            default_model: v.default_model,
        }
    }
}

impl From<AiProvidersDisk> for AiProvidersView {
    fn from(v: AiProvidersDisk) -> Self {
        Self {
            default: v.default,
            anthropic: v.anthropic.into(),
            google: v.google.into(),
            openai: v.openai.into(),
            ollama: v.ollama.into(),
        }
    }
}

impl From<AiProvidersView> for AiProvidersDisk {
    fn from(v: AiProvidersView) -> Self {
        Self {
            default: v.default,
            anthropic: v.anthropic.into(),
            google: v.google.into(),
            openai: v.openai.into(),
            ollama: v.ollama.into(),
        }
    }
}

macro_rules! trivial_from {
    ($disk:ty, $view:ty, { $($f:ident),* $(,)? }) => {
        impl From<$disk> for $view {
            fn from(v: $disk) -> Self {
                Self { $($f: v.$f),* }
            }
        }
        impl From<$view> for $disk {
            fn from(v: $view) -> Self {
                Self { $($f: v.$f),* }
            }
        }
    };
}

trivial_from!(PerformanceDisk, PerformanceView, {
    initial_pool_size,
    max_pool_size,
    max_active_sessions,
    recycle_enabled,
    max_pty_age_minutes,
    warmup_delay_ms,
    poll_interval_ms,
});
trivial_from!(KeyboardDisk, KeyboardView, { terminal_exit_method, double_escape_timeout_ms, custom_bindings });
trivial_from!(UiDisk, UiView, {
    sidebar_width,
    drawer_height,
    drawer_panel_order,
    show_session_cost_in_header,
    dim_unfocused_panes,
    unfocused_opacity,
});
trivial_from!(NotificationsDisk, NotificationsView, {
    task_completed,
    agent_error,
    merge_conflict,
    review_ready,
    cost_threshold,
    position,
    duration_ms,
});
trivial_from!(GitDisk, GitView, {
    default_merge_strategy,
    auto_delegate_conflicts,
    worktree_base_path,
    branch_prefix,
});
trivial_from!(SessionDisk, SessionView, { auto_save, auto_save_interval_seconds });
trivial_from!(GastownDisk, GastownView, { cli_path, workspace_path, pinned_version });

impl From<SettingsDisk> for SettingsView {
    fn from(v: SettingsDisk) -> Self {
        Self {
            version: v.version,
            ai_providers: v.ai_providers.into(),
            performance: v.performance.into(),
            keyboard: v.keyboard.into(),
            ui: v.ui.into(),
            notifications: v.notifications.into(),
            git: v.git.into(),
            session: v.session.into(),
            gastown: v.gastown.into(),
        }
    }
}

impl From<SettingsView> for SettingsDisk {
    fn from(v: SettingsView) -> Self {
        Self {
            version: v.version,
            ai_providers: v.ai_providers.into(),
            performance: v.performance.into(),
            keyboard: v.keyboard.into(),
            ui: v.ui.into(),
            notifications: v.notifications.into(),
            git: v.git.into(),
            session: v.session.into(),
            gastown: v.gastown.into(),
        }
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    app.path()
        .resolve("synk/settings.json", BaseDirectory::Config)
        .context("resolve config path for settings.json")
}

pub fn settings_get(app: &tauri::AppHandle) -> Result<SettingsView> {
    let path = settings_path(app)?;
    let text = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(SettingsView::default()),
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };

    let mut disk: SettingsDisk = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => SettingsDisk::default(),
    };

    // Lightweight migrations so defaults improve over time without manual settings edits.
    // Only overwrite known-previous defaults (so user customizations are preserved).
    let mut changed = false;
    if disk.version < 2 {
        if disk.ai_providers.openai.default_model.trim().is_empty()
            || disk.ai_providers.openai.default_model == "gpt-4o"
            || disk.ai_providers.openai.default_model == "o4-mini"
            || disk.ai_providers.openai.default_model == "o3-mini"
        {
            disk.ai_providers.openai.default_model = "gpt-5.3-codex".to_string();
        }
        disk.version = 2;
        changed = true;
    }

    if changed {
        // Best-effort persist so next launch sees the migrated defaults.
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(text) = serde_json::to_string_pretty(&disk) {
            let _ = fs::write(&path, format!("{text}\n"));
        }
    }

    Ok(SettingsView::from(disk))
}

pub fn settings_set(app: &tauri::AppHandle, view: SettingsView) -> Result<SettingsView> {
    let path = settings_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create config dir {}", parent.display()))?;
    }

    // Normalize via disk schema so missing fields get defaults.
    let mut disk = SettingsDisk::from(view);
    if disk.version == 0 {
        disk.version = 2;
    }
    if disk.version < 2 {
        disk.version = 2;
    }

    let text = serde_json::to_string_pretty(&disk).context("serialize settings.json")?;
    fs::write(&path, format!("{text}\n")).with_context(|| format!("write {}", path.display()))?;
    Ok(SettingsView::from(disk))
}

pub fn pool_config_from_settings(view: &SettingsView) -> PoolConfig {
    let p = &view.performance;
    let mut cfg = PoolConfig::default();
    cfg.initial_pool_size = p.initial_pool_size;
    cfg.max_pool_size = p.max_pool_size.max(1).max(cfg.initial_pool_size.max(1));
    cfg.max_active = p.max_active_sessions.max(1);
    cfg.recycle_enabled = p.recycle_enabled;
    cfg.max_pty_age = Duration::from_secs(p.max_pty_age_minutes.saturating_mul(60));
    cfg.warmup_delay = Duration::from_millis(p.warmup_delay_ms);
    // poll_interval_ms is currently unused by the PTY pool, but keep it in settings anyway.
    cfg
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderKeyValidationResult {
    pub ok: bool,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelsResult {
    pub ok: bool,
    pub models: Vec<String>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<u16>,
}

pub fn validate_provider_key(provider: &str, key: &str) -> Result<ProviderKeyValidationResult> {
    let provider = provider.to_ascii_lowercase();
    let key = key.trim();
    if key.is_empty() {
        return Ok(ProviderKeyValidationResult {
            ok: false,
            message: "Empty API key".to_string(),
            status_code: None,
        });
    }

    // Network validation is best-effort. We only need a 2xx to display "valid".
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(6))
        .build()
        .context("build http client")?;

    let resp = match provider.as_str() {
        "anthropic" => client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .send(),
        "openai" => client
            .get("https://api.openai.com/v1/models")
            .bearer_auth(key)
            .send(),
        "google" | "gemini" => client
            .get(format!(
                "https://generativelanguage.googleapis.com/v1beta/models?key={}",
                urlencoding::encode(key)
            ))
            .send(),
        _ => {
            return Ok(ProviderKeyValidationResult {
                ok: false,
                message: format!("Unknown provider: {provider}"),
                status_code: None,
            })
        }
    };

    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            return Ok(ProviderKeyValidationResult {
                ok: false,
                message: format!("Request failed: {e}"),
                status_code: None,
            })
        }
    };

    let code = resp.status().as_u16();
    if resp.status().is_success() {
        Ok(ProviderKeyValidationResult {
            ok: true,
            message: "Valid".to_string(),
            status_code: Some(code),
        })
    } else {
        Ok(ProviderKeyValidationResult {
            ok: false,
            message: "Invalid".to_string(),
            status_code: Some(code),
        })
    }
}

fn extract_model_strings(v: &serde_json::Value) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();

    if let Some(arr) = v.get("data").and_then(|a| a.as_array()) {
        for row in arr {
            if let Some(id) = row.get("id").and_then(|s| s.as_str()) {
                out.push(id.to_string());
            }
        }
    }

    if out.is_empty() {
        if let Some(arr) = v.get("models").and_then(|a| a.as_array()) {
            for row in arr {
                if let Some(id) = row.get("id").and_then(|s| s.as_str()) {
                    out.push(id.to_string());
                    continue;
                }
                if let Some(name) = row.get("name").and_then(|s| s.as_str()) {
                    let name = name.strip_prefix("models/").unwrap_or(name);
                    out.push(name.to_string());
                }
            }
        }
    }

    // Some APIs nest lists under "model" or other keys; keep it minimal for now.
    out.sort();
    out.dedup();
    out
}

pub fn list_provider_models(provider: &str, key: &str) -> Result<ProviderModelsResult> {
    let provider = provider.to_ascii_lowercase();
    let key = key.trim();
    if key.is_empty() {
        return Ok(ProviderModelsResult {
            ok: false,
            models: Vec::new(),
            message: "Empty API key".to_string(),
            status_code: None,
        });
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .context("build http client")?;

    let resp = match provider.as_str() {
        "anthropic" => client
            .get("https://api.anthropic.com/v1/models")
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .send(),
        "openai" => client
            .get("https://api.openai.com/v1/models")
            .bearer_auth(key)
            .send(),
        "google" | "gemini" => client
            .get(format!(
                "https://generativelanguage.googleapis.com/v1beta/models?key={}",
                urlencoding::encode(key)
            ))
            .send(),
        _ => {
            return Ok(ProviderModelsResult {
                ok: false,
                models: Vec::new(),
                message: format!("Unknown provider: {provider}"),
                status_code: None,
            })
        }
    };

    let resp = match resp {
        Ok(r) => r,
        Err(e) => {
            return Ok(ProviderModelsResult {
                ok: false,
                models: Vec::new(),
                message: format!("Request failed: {e}"),
                status_code: None,
            })
        }
    };

    let code = resp.status().as_u16();
    if !resp.status().is_success() {
        return Ok(ProviderModelsResult {
            ok: false,
            models: Vec::new(),
            message: "Request failed".to_string(),
            status_code: Some(code),
        });
    }

    let json: serde_json::Value = resp.json().unwrap_or(serde_json::Value::Null);
    let models = extract_model_strings(&json);
    Ok(ProviderModelsResult {
        ok: !models.is_empty(),
        models,
        message: "OK".to_string(),
        status_code: Some(code),
    })
}
