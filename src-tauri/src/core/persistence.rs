use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::path::BaseDirectory;
use tauri::Manager;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::core::agent_detection::AgentType;
use crate::core::session_manager::SessionInfo;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectDisk {
    pub path: String,
    pub name: String,
    pub last_opened: String,
    pub orchestration_mode: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ProjectsFileDisk {
    pub projects: Vec<ProjectDisk>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    pub last_opened: String,
    pub orchestration_mode: String,
}

fn now_rfc3339() -> Result<String> {
    Ok(OffsetDateTime::now_utc().format(&Rfc3339)?)
}

fn projects_file_path(app: &tauri::AppHandle) -> Result<PathBuf> {
    app.path()
        .resolve("synk/projects.json", BaseDirectory::Config)
        .context("resolve config path for projects.json")
}

fn read_projects_file(app: &tauri::AppHandle) -> Result<ProjectsFileDisk> {
    let path = projects_file_path(app)?;
    let text = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ProjectsFileDisk::default())
        }
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };
    let parsed: ProjectsFileDisk =
        serde_json::from_str(&text).with_context(|| format!("parse {}", path.display()))?;
    Ok(parsed)
}

fn write_projects_file(app: &tauri::AppHandle, data: &ProjectsFileDisk) -> Result<()> {
    let path = projects_file_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create config dir {}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(data).context("serialize projects.json")?;
    fs::write(&path, format!("{text}\n")).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

fn ensure_synk_dir(project_path: &Path) -> Result<()> {
    let meta = fs::metadata(project_path)
        .with_context(|| format!("read metadata for {}", project_path.display()))?;
    if !meta.is_dir() {
        anyhow::bail!("not a directory: {}", project_path.display());
    }
    fs::create_dir_all(project_path.join(".synk"))
        .with_context(|| format!("create .synk in {}", project_path.display()))?;
    Ok(())
}

fn project_name_from_path(project_path: &Path) -> String {
    project_path
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("project")
        .to_string()
}

fn to_recent(p: ProjectDisk) -> RecentProject {
    RecentProject {
        path: p.path,
        name: p.name,
        last_opened: p.last_opened,
        orchestration_mode: p.orchestration_mode,
    }
}

pub fn list_recent_projects(app: &tauri::AppHandle) -> Result<Vec<RecentProject>> {
    let mut file = read_projects_file(app)?;
    // RFC3339 sorts lexicographically, so this yields "most recent first".
    file.projects
        .sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    Ok(file.projects.into_iter().map(to_recent).collect())
}

pub fn open_project(app: &tauri::AppHandle, project_path: &Path) -> Result<RecentProject> {
    ensure_synk_dir(project_path)?;

    let now = now_rfc3339()?;
    let path_str = project_path.to_string_lossy().to_string();
    let name = project_name_from_path(project_path);

    let mut file = read_projects_file(app)?;

    let mut orchestration_mode = "manual".to_string();
    let mut found = None;
    for (idx, p) in file.projects.iter_mut().enumerate() {
        if p.path == path_str {
            p.name = name.clone();
            p.last_opened = now.clone();
            if p.orchestration_mode.is_empty() {
                p.orchestration_mode = "manual".to_string();
            }
            orchestration_mode = p.orchestration_mode.clone();
            found = Some(idx);
            break;
        }
    }

    if found.is_none() {
        file.projects.push(ProjectDisk {
            path: path_str.clone(),
            name: name.clone(),
            last_opened: now.clone(),
            orchestration_mode: orchestration_mode.clone(),
        });
    }

    // Keep list tidy; most recent first.
    file.projects
        .sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
    file.projects.truncate(30);

    write_projects_file(app, &file)?;

    Ok(RecentProject {
        path: path_str,
        name,
        last_opened: now,
        orchestration_mode,
    })
}

// -----------------------------------------------------------------------------
// Project-level .synk/config.json (Phase 2.3)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub struct SessionConfigDisk {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<AgentType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_isolation: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionConfigView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<AgentType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_isolation: Option<bool>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub skills: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<String>,
}

impl From<SessionConfigDisk> for SessionConfigView {
    fn from(v: SessionConfigDisk) -> Self {
        Self {
            agent_type: v.agent_type,
            branch: v.branch,
            worktree_isolation: v.worktree_isolation,
            skills: v.skills,
            mcp_servers: v.mcp_servers,
        }
    }
}

impl From<SessionConfigView> for SessionConfigDisk {
    fn from(v: SessionConfigView) -> Self {
        Self {
            agent_type: v.agent_type,
            branch: v.branch,
            worktree_isolation: v.worktree_isolation,
            skills: v.skills,
            mcp_servers: v.mcp_servers,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectConfigView {
    pub project_path: String,
    pub config_path: String,
    pub sessions: std::collections::HashMap<String, SessionConfigView>,
}

fn project_config_path(project_path: &Path) -> PathBuf {
    project_path.join(".synk").join("config.json")
}

fn read_text_if_exists(path: &Path) -> Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e).with_context(|| format!("read {}", path.display())),
    }
}

fn read_project_config_value(project_path: &Path) -> Result<Value> {
    ensure_synk_dir(project_path)?;
    let path = project_config_path(project_path);
    let Some(text) = read_text_if_exists(&path)? else {
        return Ok(Value::Object(Default::default()));
    };
    let mut root: Value =
        serde_json::from_str(&text).unwrap_or_else(|_| Value::Object(Default::default()));
    if !root.is_object() {
        root = Value::Object(Default::default());
    }
    Ok(root)
}

fn write_project_config_value(project_path: &Path, root: &Value) -> Result<()> {
    ensure_synk_dir(project_path)?;
    let path = project_config_path(project_path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create dir {}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(root).context("serialize .synk/config.json")?;
    fs::write(&path, format!("{text}\n")).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

pub fn project_config_get(project_path: &Path) -> Result<ProjectConfigView> {
    let root = read_project_config_value(project_path)?;
    let config_path = project_config_path(project_path);
    let sessions = root
        .get("sessions")
        .and_then(|v| v.as_object())
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| {
                    let parsed: SessionConfigDisk = serde_json::from_value(v.clone()).ok()?;
                    Some((k.clone(), SessionConfigView::from(parsed)))
                })
                .collect::<std::collections::HashMap<_, _>>()
        })
        .unwrap_or_default();

    Ok(ProjectConfigView {
        project_path: project_path.to_string_lossy().to_string(),
        config_path: config_path.to_string_lossy().to_string(),
        sessions,
    })
}

pub fn project_session_config_get(
    project_path: &Path,
    session_id: usize,
) -> Result<Option<SessionConfigView>> {
    let root = read_project_config_value(project_path)?;
    let key = session_id.to_string();
    let Some(v) = root.get("sessions").and_then(|s| s.get(&key)) else {
        return Ok(None);
    };
    let parsed: SessionConfigDisk =
        serde_json::from_value(v.clone()).with_context(|| format!("parse sessions.{key}"))?;
    Ok(Some(SessionConfigView::from(parsed)))
}

pub fn project_session_config_set(
    project_path: &Path,
    session_id: usize,
    config: SessionConfigDisk,
) -> Result<()> {
    let mut root = read_project_config_value(project_path)?;

    if !root.get("version").is_some() {
        root["version"] = Value::Number(1.into());
    }

    if !root.get("project_path").is_some() {
        root["project_path"] = Value::String(project_path.to_string_lossy().to_string());
    }
    if !root.get("project_name").is_some() {
        root["project_name"] = Value::String(project_name_from_path(project_path));
    }

    if !root.get("sessions").is_some() || !root["sessions"].is_object() {
        root["sessions"] = Value::Object(Default::default());
    }

    let key = session_id.to_string();
    let obj = root["sessions"]
        .as_object_mut()
        .expect("sessions is object");
    obj.insert(
        key,
        serde_json::to_value(config).context("serialize SessionConfigDisk")?,
    );

    write_project_config_value(project_path, &root)?;
    Ok(())
}

// -----------------------------------------------------------------------------
// Session snapshots (Phase 2.4)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridLayoutSnapshot {
    pub session_count: usize,
    pub layout: String, // e.g. "2x2"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPaneSnapshot {
    pub pane_index: usize,
    pub agent_type: AgentType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    pub worktree_enabled: bool,
    pub working_dir: String,
    #[serde(default)]
    pub skills: Vec<String>,
    #[serde(default)]
    pub mcp_servers: Vec<String>,
    #[serde(default)]
    pub env_overrides: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub version: u32,
    pub name: String,
    pub saved_at: String,
    pub project_path: String,
    pub orchestration_mode: String,
    pub grid_layout: GridLayoutSnapshot,
    pub sessions: Vec<SessionPaneSnapshot>,
    #[serde(default)]
    pub task_queue_snapshot: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshotMeta {
    pub id: String,   // filename stem
    pub name: String, // snapshot name (human label)
    pub kind: String, // "named" | "autosave"
    pub path: String,
    pub saved_at: String,
    pub project_path: String,
    pub session_count: usize,
    pub layout: String,
}

fn sessions_dir(app: &tauri::AppHandle) -> Result<PathBuf> {
    let path = app
        .path()
        .resolve("synk/sessions", BaseDirectory::Config)
        .context("resolve config path for sessions dir")?;
    fs::create_dir_all(&path).with_context(|| format!("create sessions dir {}", path.display()))?;
    Ok(path)
}

fn grid_for_count(count: usize) -> (usize, usize) {
    if count <= 1 {
        return (1, 1);
    }
    if count == 2 {
        return (2, 1);
    }
    if count <= 4 {
        return (2, 2);
    }
    if count <= 6 {
        return (3, 2);
    }
    if count <= 9 {
        return (3, 3);
    }
    (4, 3)
}

fn slugify_filename(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;

    for ch in name.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
            continue;
        }

        if c == '-' || c == '_' || c == '.' {
            out.push(c);
            prev_dash = false;
            continue;
        }

        // Treat everything else as a separator.
        if !out.is_empty() && !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }

    while out.ends_with('-') {
        out.pop();
    }

    if out.is_empty() {
        "session".to_string()
    } else {
        out
    }
}

fn snapshot_path_named(app: &tauri::AppHandle, name: &str) -> Result<(String, PathBuf)> {
    let id = slugify_filename(name);
    let dir = sessions_dir(app)?;
    Ok((id.clone(), dir.join(format!("{id}.json"))))
}

fn snapshot_id_autosave(project_path: &Path) -> String {
    let project = slugify_filename(&project_name_from_path(project_path));
    format!("{project}-autosave")
}

fn snapshot_path_autosave(
    app: &tauri::AppHandle,
    project_path: &Path,
) -> Result<(String, PathBuf)> {
    let id = snapshot_id_autosave(project_path);
    let dir = sessions_dir(app)?;
    Ok((id.clone(), dir.join(format!("{id}.json"))))
}

fn snapshot_meta(
    id: String,
    kind: &str,
    snapshot: &SessionSnapshot,
    path: &Path,
) -> SessionSnapshotMeta {
    SessionSnapshotMeta {
        id,
        name: snapshot.name.clone(),
        kind: kind.to_string(),
        path: path.to_string_lossy().to_string(),
        saved_at: snapshot.saved_at.clone(),
        project_path: snapshot.project_path.clone(),
        session_count: snapshot.grid_layout.session_count,
        layout: snapshot.grid_layout.layout.clone(),
    }
}

fn write_snapshot(path: &Path, snapshot: &SessionSnapshot) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).with_context(|| format!("create dir {}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(snapshot).context("serialize session snapshot")?;
    fs::write(path, format!("{text}\n")).with_context(|| format!("write {}", path.display()))?;
    Ok(())
}

fn read_snapshot(path: &Path) -> Result<SessionSnapshot> {
    let text = fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    let snap: SessionSnapshot =
        serde_json::from_str(&text).with_context(|| format!("parse {}", path.display()))?;
    Ok(snap)
}

fn build_snapshot(
    project_path: &Path,
    orchestration_mode: &str,
    name: &str,
    sessions: Vec<SessionInfo>,
    session_configs: HashMap<usize, SessionConfigView>, // keyed by pane_index
) -> Result<SessionSnapshot> {
    let saved_at = now_rfc3339()?;
    let mut ordered = sessions;
    ordered.sort_by_key(|s| s.pane_index);
    let count = ordered.len();
    let (cols, rows) = grid_for_count(count);

    let mut panes: Vec<SessionPaneSnapshot> = Vec::with_capacity(ordered.len());
    for s in ordered {
        let cfg = session_configs.get(&s.pane_index);
        let skills = cfg.map(|c| c.skills.clone()).unwrap_or_default();
        let mcp_servers = cfg.map(|c| c.mcp_servers.clone()).unwrap_or_default();
        let worktree_enabled = cfg.and_then(|c| c.worktree_isolation).unwrap_or(false);
        let branch = s
            .branch
            .clone()
            .or_else(|| cfg.and_then(|c| c.branch.clone()));

        let wd = s
            .working_dir
            .clone()
            .unwrap_or_else(|| project_path.to_string_lossy().to_string());

        panes.push(SessionPaneSnapshot {
            pane_index: s.pane_index,
            agent_type: s.agent_type,
            branch,
            worktree_enabled,
            working_dir: wd,
            skills,
            mcp_servers,
            env_overrides: HashMap::new(),
        });
    }

    Ok(SessionSnapshot {
        version: 1,
        name: name.to_string(),
        saved_at,
        project_path: project_path.to_string_lossy().to_string(),
        orchestration_mode: orchestration_mode.to_string(),
        grid_layout: GridLayoutSnapshot {
            session_count: count,
            layout: format!("{cols}x{rows}"),
        },
        sessions: panes,
        task_queue_snapshot: Vec::new(),
    })
}

pub fn session_snapshot_save_named(
    app: &tauri::AppHandle,
    project_path: &Path,
    name: &str,
    orchestration_mode: &str,
    sessions: Vec<SessionInfo>,
) -> Result<SessionSnapshotMeta> {
    let mut session_configs: HashMap<usize, SessionConfigView> = HashMap::new();
    for s in &sessions {
        if let Some(cfg) = project_session_config_get(project_path, s.pane_index)? {
            session_configs.insert(s.pane_index, cfg);
        }
    }

    let snapshot = build_snapshot(
        project_path,
        orchestration_mode,
        name,
        sessions,
        session_configs,
    )?;
    let (id, path) = snapshot_path_named(app, name)?;
    write_snapshot(&path, &snapshot)?;
    Ok(snapshot_meta(id, "named", &snapshot, &path))
}

pub fn session_snapshot_save_autosave(
    app: &tauri::AppHandle,
    project_path: &Path,
    orchestration_mode: &str,
    sessions: Vec<SessionInfo>,
) -> Result<SessionSnapshotMeta> {
    let mut session_configs: HashMap<usize, SessionConfigView> = HashMap::new();
    for s in &sessions {
        if let Some(cfg) = project_session_config_get(project_path, s.pane_index)? {
            session_configs.insert(s.pane_index, cfg);
        }
    }

    let name = "autosave";
    let snapshot = build_snapshot(
        project_path,
        orchestration_mode,
        name,
        sessions,
        session_configs,
    )?;
    let (id, path) = snapshot_path_autosave(app, project_path)?;
    write_snapshot(&path, &snapshot)?;
    Ok(snapshot_meta(id, "autosave", &snapshot, &path))
}

pub fn session_snapshot_load(app: &tauri::AppHandle, id: &str) -> Result<SessionSnapshot> {
    let clean = slugify_filename(id);
    let dir = sessions_dir(app)?;
    let path = dir.join(format!("{clean}.json"));
    read_snapshot(&path)
}

pub fn session_snapshot_list(
    app: &tauri::AppHandle,
    project_path: Option<&Path>,
) -> Result<Vec<SessionSnapshotMeta>> {
    let dir = sessions_dir(app)?;
    let mut out: Vec<SessionSnapshotMeta> = Vec::new();

    let entries = match fs::read_dir(&dir) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e).with_context(|| format!("read_dir {}", dir.display())),
    };

    for ent in entries {
        let ent = match ent {
            Ok(v) => v,
            Err(_) => continue,
        };
        let path = ent.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let id = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }

        let snap = match read_snapshot(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };

        if let Some(pp) = project_path {
            if snap.project_path != pp.to_string_lossy().as_ref() {
                continue;
            }
        }

        let kind = if id.ends_with("-autosave") {
            "autosave"
        } else {
            "named"
        };
        out.push(snapshot_meta(id, kind, &snap, &path));
    }

    out.sort_by(|a, b| b.saved_at.cmp(&a.saved_at));
    Ok(out)
}

pub fn session_snapshot_autosave_meta(
    app: &tauri::AppHandle,
    project_path: &Path,
) -> Result<Option<SessionSnapshotMeta>> {
    let (id, path) = snapshot_path_autosave(app, project_path)?;
    let text = match fs::read_to_string(&path) {
        Ok(v) => v,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e).with_context(|| format!("read {}", path.display())),
    };
    let snap: SessionSnapshot =
        serde_json::from_str(&text).with_context(|| format!("parse {}", path.display()))?;
    Ok(Some(snapshot_meta(id, "autosave", &snap, &path)))
}
