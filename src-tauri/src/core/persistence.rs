use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use tauri::path::BaseDirectory;
use tauri::Manager;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

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
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(ProjectsFileDisk::default()),
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
