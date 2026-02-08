use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;

use tauri::State;

use crate::core::git_manager::{GitManager, OrphanWorktree, WorktreeInfo};
use crate::core::session_manager::SharedSessionManager;
use crate::core::settings as core_settings;

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCreateWorktreeArgs {
    pub session_id: usize,
    pub branch: String,
    #[serde(default)]
    pub base_branch: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCreateWorktreeResponse {
    pub worktree_path: String,
    pub branch: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoveWorktreeArgs {
    pub session_id: usize,
    #[serde(default)]
    pub branch: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRemoveWorktreeResponse {
    pub success: bool,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitListWorktreesArgs {
    pub project_path: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDetectOrphansArgs {
    pub project_path: String,
    /// Override for testing/debug; default is 24 hours.
    #[serde(default)]
    pub min_age_seconds: Option<u64>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCleanupOrphansResponse {
    pub removed: Vec<String>,
    pub failed: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchesArgs {
    pub project_path: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitEnsureWorktreeArgs {
    pub project_path: String,
    pub branch: String,
    #[serde(default)]
    pub base_branch: Option<String>,
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

fn active_worktrees_for_project(
    manager: &crate::core::session_manager::SessionManager,
    project_path: &str,
    worktree_root: &std::path::Path,
) -> HashSet<PathBuf> {
    let mut out = HashSet::new();
    for s in manager.list_sessions() {
        if s.project_path != project_path {
            continue;
        }
        let Some(wd) = s.working_dir else { continue };
        let p = PathBuf::from(wd);
        if p.starts_with(worktree_root) {
            out.insert(p);
        }
    }
    out
}

#[tauri::command]
pub fn git_create_worktree(
    app: tauri::AppHandle,
    sessions: State<'_, SharedSessionManager>,
    args: GitCreateWorktreeArgs,
) -> std::result::Result<GitCreateWorktreeResponse, String> {
    let mut guard = sessions.lock().expect("session manager mutex poisoned");
    let info = guard
        .get_session_info(args.session_id)
        .ok_or_else(|| format!("unknown session_id {}", args.session_id))?;

    let gm = make_manager(&app, PathBuf::from(&info.project_path))?;
    let base_branch = match args.base_branch.as_deref() {
        Some(v) => v.to_string(),
        None => gm.default_base_branch().map_err(|e| format!("{e:#}"))?,
    };
    let (path, branch) = gm
        .create_worktree(&args.branch, &base_branch)
        .map_err(|e| format!("{e:#}"))?;

    let path_str = path.to_string_lossy().to_string();

    // Only auto-`cd` for plain terminal sessions. For agent CLIs (codex/claude/gemini),
    // writing `cd ...` goes into the agent prompt (not the shell) and won't actually switch.
    // The UI should restart the session in the desired dir instead.
    if info.agent_type == crate::core::agent_detection::AgentType::Terminal {
        let cd_cmd = format!("cd '{}'\r\n", path_str.replace('\'', "'\\''"));
        let _ = guard.write(args.session_id, &cd_cmd);
        let _ = guard.set_session_git_context(
            args.session_id,
            Some(branch.clone()),
            Some(path_str.clone()),
        );
    }

    Ok(GitCreateWorktreeResponse {
        worktree_path: path_str,
        branch,
    })
}

#[tauri::command]
pub fn git_ensure_worktree(
    app: tauri::AppHandle,
    args: GitEnsureWorktreeArgs,
) -> std::result::Result<GitCreateWorktreeResponse, String> {
    let gm = make_manager(&app, PathBuf::from(&args.project_path))?;
    let base_branch = match args.base_branch.as_deref() {
        Some(v) => v.to_string(),
        None => gm.default_base_branch().map_err(|e| format!("{e:#}"))?,
    };
    let (path, branch) = gm
        .create_worktree(&args.branch, &base_branch)
        .map_err(|e| format!("{e:#}"))?;
    Ok(GitCreateWorktreeResponse {
        worktree_path: path.to_string_lossy().to_string(),
        branch,
    })
}

#[tauri::command]
pub fn git_remove_worktree(
    app: tauri::AppHandle,
    sessions: State<'_, SharedSessionManager>,
    args: GitRemoveWorktreeArgs,
) -> std::result::Result<GitRemoveWorktreeResponse, String> {
    let mut guard = sessions.lock().expect("session manager mutex poisoned");
    let info = guard
        .get_session_info(args.session_id)
        .ok_or_else(|| format!("unknown session_id {}", args.session_id))?;

    let requested_branch = args.branch.clone();
    let branch = requested_branch
        .clone()
        .or(info.branch.clone())
        .ok_or_else(|| "session has no branch".to_string())?;
    let project_path = PathBuf::from(&info.project_path);
    let gm = make_manager(&app, project_path.clone())?;
    gm.remove_worktree(&branch).map_err(|e| format!("{e:#}"))?;

    // Only auto-move the *current session* back to root when removing its *current branch*,
    // and only for plain terminal sessions. Agent CLIs treat `cd` as input, not shell.
    let removing_current_branch = match (&requested_branch, &info.branch) {
        (None, _) => true,
        (Some(req), Some(cur)) => req == cur,
        (Some(_), None) => false,
    };
    if removing_current_branch && info.agent_type == crate::core::agent_detection::AgentType::Terminal {
        let cd_cmd = format!("cd '{}'\r\n", info.project_path.replace('\'', "'\\''"));
        let _ = guard.write(args.session_id, &cd_cmd);
        let _ = guard.set_session_git_context(args.session_id, None, Some(info.project_path.clone()));
    }

    Ok(GitRemoveWorktreeResponse { success: true })
}

// Alias to match the (older) command name in the spec reference.
#[tauri::command]
pub fn git_delete_worktree(
    app: tauri::AppHandle,
    sessions: State<'_, SharedSessionManager>,
    args: GitRemoveWorktreeArgs,
) -> std::result::Result<GitRemoveWorktreeResponse, String> {
    git_remove_worktree(app, sessions, args)
}

#[tauri::command]
pub fn git_list_worktrees(
    app: tauri::AppHandle,
    args: GitListWorktreesArgs,
) -> std::result::Result<Vec<WorktreeInfo>, String> {
    let gm = make_manager(&app, PathBuf::from(args.project_path))?;
    gm.list_worktrees().map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn git_detect_orphans(
    app: tauri::AppHandle,
    sessions: State<'_, SharedSessionManager>,
    args: GitDetectOrphansArgs,
) -> std::result::Result<Vec<OrphanWorktree>, String> {
    let project_path = PathBuf::from(&args.project_path);
    let gm = make_manager(&app, project_path)?;

    let min_age = Duration::from_secs(args.min_age_seconds.unwrap_or(24 * 60 * 60));
    let guard = sessions.lock().expect("session manager mutex poisoned");
    let active =
        active_worktrees_for_project(&guard, &args.project_path, gm.worktree_project_root());

    gm.detect_orphans(&active, min_age)
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn git_cleanup_orphans(
    app: tauri::AppHandle,
    sessions: State<'_, SharedSessionManager>,
    args: GitDetectOrphansArgs,
) -> std::result::Result<GitCleanupOrphansResponse, String> {
    let project_path = PathBuf::from(&args.project_path);
    let gm = make_manager(&app, project_path)?;

    let min_age = Duration::from_secs(args.min_age_seconds.unwrap_or(24 * 60 * 60));
    let guard = sessions.lock().expect("session manager mutex poisoned");
    let active =
        active_worktrees_for_project(&guard, &args.project_path, gm.worktree_project_root());

    let orphans = gm
        .detect_orphans(&active, min_age)
        .map_err(|e| format!("{e:#}"))?;

    let mut removed = Vec::new();
    let mut failed = Vec::new();
    for o in orphans {
        let p = o.info.path.clone();
        match gm.cleanup_orphan(&o) {
            Ok(()) => removed.push(p),
            Err(_) => failed.push(p),
        }
    }

    Ok(GitCleanupOrphansResponse { removed, failed })
}

#[tauri::command]
pub fn git_branches(
    app: tauri::AppHandle,
    args: GitBranchesArgs,
) -> std::result::Result<Vec<String>, String> {
    let gm = make_manager(&app, PathBuf::from(args.project_path))?;
    gm.list_branches().map_err(|e| format!("{e:#}"))
}
