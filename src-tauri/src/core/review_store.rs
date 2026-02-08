use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use tauri::path::BaseDirectory;
use tauri::Manager;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::core::git_manager::{DiffLineType, FileDiff, GitManager, MergeStrategy};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewStatus {
    Pending,
    InReview,
    Approved,
    Rejected,
    ChangesRequested,
    Merging,
    Merged,
    MergeConflict,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewDecision {
    Approved,
    Rejected,
    ChangesRequested,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComment {
    pub id: String,
    pub file_path: String,
    pub line_number: u32,
    pub body: String,
    pub author: String, // "user" | "agent"
    pub created_at: String,
    pub resolved: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem {
    pub id: String,
    pub task_id: Option<String>,
    pub session_id: usize,
    pub branch: String,
    pub base_branch: String,
    pub status: ReviewStatus,
    pub created_at: String,
    pub updated_at: String,

    pub files_changed: u32,
    pub additions: u32,
    pub deletions: u32,
    pub files: Vec<FileDiff>,

    #[serde(default)]
    pub comments: Vec<ReviewComment>,
    pub review_decision: Option<ReviewDecision>,
    pub merge_strategy: Option<MergeStrategy>,
}

fn now_rfc3339() -> Result<String> {
    Ok(OffsetDateTime::now_utc().format(&Rfc3339)?)
}

fn project_slug(project_path: &Path) -> String {
    project_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("project")
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

pub fn review_root_dir(app: &tauri::AppHandle, project_path: &Path) -> Result<PathBuf> {
    let project = project_slug(project_path);
    app.path()
        .resolve(format!("synk/reviews/{project}"), BaseDirectory::Config)
        .context("resolve reviews dir")
}

fn review_paths(
    app: &tauri::AppHandle,
    project_path: &Path,
    id: &str,
) -> Result<(PathBuf, PathBuf, PathBuf)> {
    let root = review_root_dir(app, project_path)?;
    let reviews = root.join("reviews");
    let comments = root.join("comments");
    let diffs = root.join("diffs");
    Ok((
        reviews.join(format!("{id}.json")),
        comments.join(format!("{id}.json")),
        diffs.join(format!("{id}.diff")),
    ))
}

fn ensure_review_dirs(app: &tauri::AppHandle, project_path: &Path) -> Result<()> {
    let root = review_root_dir(app, project_path)?;
    fs::create_dir_all(root.join("reviews")).context("create reviews/ dir")?;
    fs::create_dir_all(root.join("comments")).context("create comments/ dir")?;
    fs::create_dir_all(root.join("diffs")).context("create diffs/ dir")?;
    Ok(())
}

fn compute_stats(files: &[FileDiff]) -> (u32, u32, u32) {
    let files_changed = files.len() as u32;
    let mut additions = 0u32;
    let mut deletions = 0u32;
    for f in files {
        for h in &f.hunks {
            for l in &h.lines {
                match l.line_type {
                    DiffLineType::Addition => additions += 1,
                    DiffLineType::Deletion => deletions += 1,
                    DiffLineType::Context => {}
                }
            }
        }
    }
    (files_changed, additions, deletions)
}

fn new_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{n}")
}

pub fn review_create(
    app: &tauri::AppHandle,
    gm: &GitManager,
    project_path: &Path,
    session_id: usize,
    branch: &str,
    base_branch: &str,
) -> Result<ReviewItem> {
    ensure_review_dirs(app, project_path)?;

    let files = gm.generate_diff(branch, base_branch)?;
    let (files_changed, additions, deletions) = compute_stats(&files);

    let id = new_id();
    let now = now_rfc3339()?;
    let item = ReviewItem {
        id: id.clone(),
        task_id: None,
        session_id,
        branch: branch.to_string(),
        base_branch: base_branch.to_string(),
        status: ReviewStatus::Pending,
        created_at: now.clone(),
        updated_at: now,
        files_changed,
        additions,
        deletions,
        files,
        comments: Vec::new(),
        review_decision: None,
        merge_strategy: None,
    };

    review_save(app, project_path, &item)?;
    Ok(item)
}

pub fn review_save(app: &tauri::AppHandle, project_path: &Path, item: &ReviewItem) -> Result<()> {
    ensure_review_dirs(app, project_path)?;
    let (review_path, comments_path, _) = review_paths(app, project_path, &item.id)?;

    let text = serde_json::to_string_pretty(item).context("serialize ReviewItem")?;
    fs::write(&review_path, format!("{text}\n"))
        .with_context(|| format!("write {}", review_path.display()))?;

    // Keep comments in a separate file too (spec 20.4), even though we currently inline them.
    let comments_text =
        serde_json::to_string_pretty(&item.comments).context("serialize ReviewComment[]")?;
    fs::write(&comments_path, format!("{comments_text}\n"))
        .with_context(|| format!("write {}", comments_path.display()))?;

    Ok(())
}

pub fn review_get(app: &tauri::AppHandle, project_path: &Path, id: &str) -> Result<ReviewItem> {
    let (review_path, comments_path, _) = review_paths(app, project_path, id)?;
    let text = fs::read_to_string(&review_path)
        .with_context(|| format!("read {}", review_path.display()))?;
    let mut item: ReviewItem = serde_json::from_str(&text).context("parse ReviewItem")?;

    if let Ok(ctext) = fs::read_to_string(&comments_path) {
        if let Ok(comments) = serde_json::from_str::<Vec<ReviewComment>>(&ctext) {
            item.comments = comments;
        }
    }

    Ok(item)
}

pub fn review_list(app: &tauri::AppHandle, project_path: &Path) -> Result<Vec<ReviewItem>> {
    ensure_review_dirs(app, project_path)?;
    let root = review_root_dir(app, project_path)?;
    let reviews_dir = root.join("reviews");

    let mut out: Vec<ReviewItem> = Vec::new();
    let entries = fs::read_dir(&reviews_dir)
        .with_context(|| format!("read_dir {}", reviews_dir.display()))?;
    for ent in entries {
        let ent = match ent {
            Ok(v) => v,
            Err(_) => continue,
        };
        let path = ent.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let text = match fs::read_to_string(&path) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let item: ReviewItem = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue,
        };
        out.push(item);
    }

    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(out)
}
