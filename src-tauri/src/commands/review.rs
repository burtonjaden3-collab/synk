use std::path::PathBuf;

use tauri::Emitter;
use tauri::State;

use crate::core::git_manager::{FileDiff, GitManager, MergeResult, MergeStrategy};
use crate::core::review_store::{ReviewComment, ReviewDecision, ReviewItem, ReviewStatus};
use crate::core::session_manager::SharedSessionManager;
use crate::core::settings as core_settings;
use crate::events::{now_rfc3339, GitEvent, GitEventType, GIT_EVENT_NAME};

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffArgs {
    pub project_path: String,
    pub branch: String,
    pub base_branch: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitMergeArgs {
    pub project_path: String,
    pub branch: String,
    pub base_branch: String,
    pub strategy: MergeStrategy,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCreateArgs {
    pub project_path: String,
    pub session_id: usize,
    pub branch: String,
    pub base_branch: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewListArgs {
    pub project_path: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewGetArgs {
    pub project_path: String,
    pub id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSetStatusArgs {
    pub project_path: String,
    pub id: String,
    pub status: ReviewStatus,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSetDecisionArgs {
    pub project_path: String,
    pub id: String,
    pub decision: ReviewDecision,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSetMergeStrategyArgs {
    pub project_path: String,
    pub id: String,
    pub strategy: MergeStrategy,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewAddCommentArgs {
    pub project_path: String,
    pub id: String,
    pub file_path: String,
    pub line_number: u32,
    pub body: String,
    #[serde(default)]
    pub author: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewResolveCommentArgs {
    pub project_path: String,
    pub id: String,
    pub comment_id: String,
    pub resolved: bool,
}

fn make_manager(
    app: &tauri::AppHandle,
    project_path: PathBuf,
) -> std::result::Result<GitManager, String> {
    let settings = core_settings::settings_get(app).map_err(|e| format!("{e:#}"))?;
    GitManager::new(
        project_path,
        &settings.git.worktree_base_path,
        &settings.git.branch_prefix,
    )
    .map_err(|e| format!("{e:#}"))
}

fn maybe_delegate_conflicts(
    sessions: &mut crate::core::session_manager::SessionManager,
    project_path: &str,
    branch: &str,
    base_branch: &str,
    conflict_files: &[String],
) {
    let mut target = None;
    for s in sessions.list_sessions() {
        if s.project_path != project_path {
            continue;
        }
        if s.branch.as_deref() == Some(branch) {
            target = Some(s.session_id);
            break;
        }
    }
    let Some(session_id) = target else {
        return;
    };

    let mut prompt = String::new();
    prompt.push_str(&format!(
        "There are merge conflicts in your branch {branch} when merging into {base_branch}.\r\n\r\n"
    ));
    prompt.push_str("Conflicting files:\r\n");
    for f in conflict_files {
        prompt.push_str(&format!("- {f}\r\n"));
    }
    prompt.push_str("\r\nPlease resolve all conflicts and commit the resolution.\r\n");

    let _ = sessions.write(session_id, &prompt);
}

#[tauri::command]
pub fn git_diff(
    app: tauri::AppHandle,
    args: GitDiffArgs,
) -> std::result::Result<Vec<FileDiff>, String> {
    let gm = make_manager(&app, PathBuf::from(args.project_path))?;
    gm.generate_diff(&args.branch, &args.base_branch)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn git_merge(
    app: tauri::AppHandle,
    sessions: State<'_, SharedSessionManager>,
    args: GitMergeArgs,
) -> std::result::Result<MergeResult, String> {
    let settings = core_settings::settings_get(&app).map_err(|e| format!("{e:#}"))?;

    let gm = make_manager(&app, PathBuf::from(&args.project_path))?;
    let branch = gm
        .normalize_branch(&args.branch)
        .map_err(|e| format!("{e:#}"))?;
    let base_branch = gm
        .normalize_base_branch(&args.base_branch)
        .map_err(|e| format!("{e:#}"))?;

    let res = gm
        .merge_branch(&branch, &base_branch, args.strategy)
        .map_err(|e| format!("{e:#}"))?;

    // Emit a UI event for the git activity feed.
    let _ = app.emit(
        GIT_EVENT_NAME,
        GitEvent {
            id: format!(
                "{}-{}",
                if res.success { "merge" } else { "conflict" },
                now_rfc3339()
            ),
            event_type: if res.success {
                GitEventType::MergeCompleted
            } else {
                GitEventType::ConflictDetected
            },
            timestamp: now_rfc3339(),
            project_path: args.project_path.clone(),
            session_id: None,
            branch: Some(branch.clone()),
            hash: None,
            message: None,
            author: None,
            base_branch: Some(base_branch.clone()),
            strategy: Some(
                match args.strategy {
                    MergeStrategy::Merge => "merge",
                    MergeStrategy::Squash => "squash",
                    MergeStrategy::Rebase => "rebase",
                }
                .to_string(),
            ),
            conflict_files: res.conflict_files.clone(),
        },
    );

    if !res.success && settings.git.auto_delegate_conflicts {
        if let Some(files) = res.conflict_files.as_deref() {
            let mut guard = sessions.lock().expect("session manager mutex poisoned");
            maybe_delegate_conflicts(&mut guard, &args.project_path, &branch, &base_branch, files);
        }
    }

    Ok(res)
}

#[tauri::command]
pub fn review_create(
    app: tauri::AppHandle,
    args: ReviewCreateArgs,
) -> std::result::Result<ReviewItem, String> {
    let project_path = PathBuf::from(&args.project_path);
    let gm = make_manager(&app, project_path.clone())?;
    let branch = gm
        .normalize_branch(&args.branch)
        .map_err(|e| format!("{e:#}"))?;
    let base_branch = gm
        .normalize_base_branch(&args.base_branch)
        .map_err(|e| format!("{e:#}"))?;

    crate::core::review_store::review_create(
        &app,
        &gm,
        &project_path,
        args.session_id,
        &branch,
        &base_branch,
    )
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn review_list(
    app: tauri::AppHandle,
    args: ReviewListArgs,
) -> std::result::Result<Vec<ReviewItem>, String> {
    let project_path = PathBuf::from(&args.project_path);
    crate::core::review_store::review_list(&app, &project_path).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn review_get(
    app: tauri::AppHandle,
    args: ReviewGetArgs,
) -> std::result::Result<ReviewItem, String> {
    let project_path = PathBuf::from(&args.project_path);
    crate::core::review_store::review_get(&app, &project_path, &args.id)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn review_set_status(
    app: tauri::AppHandle,
    args: ReviewSetStatusArgs,
) -> std::result::Result<ReviewItem, String> {
    let project_path = PathBuf::from(&args.project_path);
    let mut item = crate::core::review_store::review_get(&app, &project_path, &args.id)
        .map_err(|e| format!("{e:#}"))?;
    item.status = args.status;
    item.updated_at = time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| format!("{e:#}"))?;
    crate::core::review_store::review_save(&app, &project_path, &item)
        .map_err(|e| format!("{e:#}"))?;
    Ok(item)
}

#[tauri::command]
pub fn review_set_decision(
    app: tauri::AppHandle,
    args: ReviewSetDecisionArgs,
) -> std::result::Result<ReviewItem, String> {
    let project_path = PathBuf::from(&args.project_path);
    let mut item = crate::core::review_store::review_get(&app, &project_path, &args.id)
        .map_err(|e| format!("{e:#}"))?;

    item.review_decision = Some(args.decision);
    item.status = match args.decision {
        ReviewDecision::Approved => ReviewStatus::Approved,
        ReviewDecision::Rejected => ReviewStatus::Rejected,
        ReviewDecision::ChangesRequested => ReviewStatus::ChangesRequested,
    };
    item.updated_at = now_rfc3339();

    crate::core::review_store::review_save(&app, &project_path, &item)
        .map_err(|e| format!("{e:#}"))?;
    Ok(item)
}

#[tauri::command]
pub fn review_set_merge_strategy(
    app: tauri::AppHandle,
    args: ReviewSetMergeStrategyArgs,
) -> std::result::Result<ReviewItem, String> {
    let project_path = PathBuf::from(&args.project_path);
    let mut item = crate::core::review_store::review_get(&app, &project_path, &args.id)
        .map_err(|e| format!("{e:#}"))?;

    item.merge_strategy = Some(args.strategy);
    item.updated_at = now_rfc3339();

    crate::core::review_store::review_save(&app, &project_path, &item)
        .map_err(|e| format!("{e:#}"))?;
    Ok(item)
}

#[tauri::command]
pub fn review_add_comment(
    app: tauri::AppHandle,
    args: ReviewAddCommentArgs,
) -> std::result::Result<ReviewItem, String> {
    let project_path = PathBuf::from(&args.project_path);
    let mut item = crate::core::review_store::review_get(&app, &project_path, &args.id)
        .map_err(|e| format!("{e:#}"))?;

    let id = format!("c-{}-{}", item.id, now_rfc3339());
    let comment = ReviewComment {
        id,
        file_path: args.file_path,
        line_number: args.line_number,
        body: args.body,
        author: args.author.unwrap_or_else(|| "user".to_string()),
        created_at: now_rfc3339(),
        resolved: false,
    };
    item.comments.push(comment);
    item.updated_at = now_rfc3339();

    crate::core::review_store::review_save(&app, &project_path, &item)
        .map_err(|e| format!("{e:#}"))?;
    Ok(item)
}

#[tauri::command]
pub fn review_resolve_comment(
    app: tauri::AppHandle,
    args: ReviewResolveCommentArgs,
) -> std::result::Result<ReviewItem, String> {
    let project_path = PathBuf::from(&args.project_path);
    let mut item = crate::core::review_store::review_get(&app, &project_path, &args.id)
        .map_err(|e| format!("{e:#}"))?;

    for c in &mut item.comments {
        if c.id == args.comment_id {
            c.resolved = args.resolved;
            break;
        }
    }
    item.updated_at = now_rfc3339();

    crate::core::review_store::review_save(&app, &project_path, &item)
        .map_err(|e| format!("{e:#}"))?;
    Ok(item)
}
