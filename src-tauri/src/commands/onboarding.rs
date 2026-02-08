use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::Manager;

use crate::core::agent_detection::{AgentRegistry, DetectedAgent};
use crate::core::settings::SettingsView;

fn config_dir(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    app.path()
        .resolve("synk", BaseDirectory::Config)
        .map_err(|e| anyhow::anyhow!("{e}"))
}

fn ensure_dir(path: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(path).map_err(|e| anyhow::anyhow!("create dir {}: {e}", path.display()))?;
    Ok(())
}

fn home_dir() -> anyhow::Result<PathBuf> {
    if let Some(v) = std::env::var_os("HOME").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(v));
    }
    if let Some(v) = std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(v));
    }
    anyhow::bail!("unable to resolve home directory (missing HOME/USERPROFILE)");
}

fn expand_home(path: &str) -> PathBuf {
    let p = path.trim();
    if p == "~" {
        return home_dir().unwrap_or_else(|_| PathBuf::from(p));
    }
    if let Some(rest) = p.strip_prefix("~/") {
        if let Ok(h) = home_dir() {
            return h.join(rest);
        }
    }
    PathBuf::from(p)
}

fn which_like(cmd: &str) -> Option<String> {
    let output = if cfg!(windows) {
        Command::new("where").arg(cmd).output().ok()
    } else {
        Command::new("which").arg(cmd).output().ok()
    }?;

    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first = stdout.lines().next()?.trim();
    if first.is_empty() {
        None
    } else {
        Some(first.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingScanResult {
    pub agents: Vec<DetectedAgent>,
    pub gt_found: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gt_path: Option<String>,
    pub gastown_workspace_path: String,
    pub gastown_workspace_found: bool,
}

#[tauri::command]
pub fn onboarding_is_first_run(app: tauri::AppHandle) -> std::result::Result<bool, String> {
    // Note: Some environments may create the config directory as a side effect of path resolution
    // or other early calls (e.g. "list recent projects"). Treat "first run" as "no sentinel
    // files exist yet", which matches the intent of "never launched / not initialized".
    let dir = config_dir(&app).map_err(|e| format!("{e:#}"))?;
    let has_settings = dir.join("settings.json").exists();
    let has_projects = dir.join("projects.json").exists();
    let has_pricing = dir.join("pricing.json").exists();
    Ok(!(has_settings || has_projects || has_pricing))
}

#[tauri::command]
pub fn onboarding_initialize(app: tauri::AppHandle) -> std::result::Result<(), String> {
    let dir = config_dir(&app).map_err(|e| format!("{e:#}"))?;
    ensure_dir(&dir).map_err(|e| format!("{e:#}"))?;

    // Directory skeleton (§29.2).
    for d in ["reviews", "sessions", "plugins"] {
        ensure_dir(&dir.join(d)).map_err(|e| format!("{e:#}"))?;
    }

    // settings.json (only create if missing).
    let settings_path = dir.join("settings.json");
    if fs::metadata(&settings_path).is_err() {
        let defaults = SettingsView::default();
        crate::core::settings::settings_set(&app, defaults).map_err(|e| format!("{e:#}"))?;
    }

    // projects.json (only create if missing).
    let projects_path = dir.join("projects.json");
    if fs::metadata(&projects_path).is_err() {
        let text = serde_json::to_string_pretty(&serde_json::json!({ "projects": [] }))
            .map_err(|e| format!("serialize projects.json: {e}"))?;
        fs::write(&projects_path, format!("{text}\n"))
            .map_err(|e| format!("write {}: {e}", projects_path.display()))?;
    }

    // pricing.json (only create if missing).
    let pricing_path = dir.join("pricing.json");
    if fs::metadata(&pricing_path).is_err() {
        // Prices are per million tokens (§23.5).
        let mut root: BTreeMap<String, BTreeMap<String, serde_json::Value>> = BTreeMap::new();

        root.insert(
            "anthropic".to_string(),
            BTreeMap::from([
                (
                    "claude-opus-4-6".to_string(),
                    serde_json::json!({ "input": 15.0, "output": 75.0 }),
                ),
                (
                    "claude-sonnet-4-5".to_string(),
                    serde_json::json!({ "input": 3.0, "output": 15.0 }),
                ),
                (
                    "claude-haiku-4-5".to_string(),
                    serde_json::json!({ "input": 0.80, "output": 4.0 }),
                ),
            ]),
        );
        root.insert(
            "openai".to_string(),
            BTreeMap::from([
                (
                    "gpt-4o".to_string(),
                    serde_json::json!({ "input": 2.50, "output": 10.0 }),
                ),
                (
                    "o3-mini".to_string(),
                    serde_json::json!({ "input": 1.10, "output": 4.40 }),
                ),
            ]),
        );
        root.insert(
            "google".to_string(),
            BTreeMap::from([
                (
                    "gemini-2.0-flash".to_string(),
                    serde_json::json!({ "input": 0.10, "output": 0.40 }),
                ),
                (
                    "gemini-2.5-pro".to_string(),
                    serde_json::json!({ "input": 1.25, "output": 10.0 }),
                ),
            ]),
        );

        let text = serde_json::to_string_pretty(&root)
            .map_err(|e| format!("serialize pricing.json: {e}"))?;
        fs::write(&pricing_path, format!("{text}\n"))
            .map_err(|e| format!("write {}: {e}", pricing_path.display()))?;
    }

    Ok(())
}

#[tauri::command]
pub fn onboarding_scan(app: tauri::AppHandle) -> std::result::Result<OnboardingScanResult, String> {
    let agents = AgentRegistry::detect().list();
    let gt_path = which_like("gt");

    // Workspace check is best-effort; default path is in settings defaults.
    let settings = crate::core::settings::settings_get(&app).unwrap_or_default();
    let workspace_raw = settings.gastown.workspace_path.clone();
    let workspace_path = expand_home(&workspace_raw);
    let workspace_found = fs::metadata(&workspace_path)
        .map(|m| m.is_dir())
        .unwrap_or(false);

    Ok(OnboardingScanResult {
        agents,
        gt_found: gt_path.is_some(),
        gt_path,
        gastown_workspace_path: workspace_raw,
        gastown_workspace_found: workspace_found,
    })
}
