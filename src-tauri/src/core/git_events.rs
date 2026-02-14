use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::Emitter;

use crate::events::{now_rfc3339, GitEvent, GitEventType, GIT_EVENT_NAME};

pub type SharedGitEventWatcher = Arc<std::sync::Mutex<GitEventWatcher>>;

#[derive(Default)]
struct RepoState {
    // Last observed branch set (for create/delete events).
    branches: HashSet<String>,
    // Last observed HEAD hash per live session_id (for commit events).
    last_head_by_session: HashMap<usize, String>,
}

pub struct GitEventWatcher {
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
    repo_state: HashMap<String, RepoState>, // keyed by project_path
}

fn git_output(cwd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn git_lines(cwd: &str, args: &[&str]) -> Vec<String> {
    git_output(cwd, args)
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .map(|l| l.to_string())
        .collect()
}

fn new_id(prefix: &str) -> String {
    let n = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_nanos();
    format!("{prefix}-{n}")
}

impl GitEventWatcher {
    pub fn new() -> Self {
        Self {
            stop: Arc::new(AtomicBool::new(false)),
            handle: None,
            repo_state: HashMap::new(),
        }
    }

    pub fn start(
        watcher: SharedGitEventWatcher,
        app: tauri::AppHandle,
        sessions: crate::core::session_manager::SharedSessionManager,
    ) {
        let watcher_for_thread = watcher.clone();

        let mut guard = watcher.lock().expect("git watcher mutex poisoned");
        if guard.handle.is_some() {
            return;
        }

        let stop = guard.stop.clone();
        guard.handle = Some(thread::spawn(move || {
            // Fixed polling interval; can be made configurable later.
            let interval = Duration::from_millis(1500);

            while !stop.load(Ordering::Relaxed) {
                let list = {
                    let s = sessions.lock().expect("session manager mutex poisoned");
                    s.list_sessions()
                };

                // Group sessions by project so we only hit git once per repo for branch list.
                let mut by_project: HashMap<String, Vec<(usize, Option<String>)>> = HashMap::new();
                for s in list {
                    by_project
                        .entry(s.project_path.clone())
                        .or_default()
                        .push((s.session_id, s.working_dir.clone()));
                }

                for (project_path, sess) in by_project {
                    // Ignore non-git folders.
                    let ok = git_output(&project_path, &["rev-parse", "--is-inside-work-tree"])
                        .map(|v| v == "true")
                        .unwrap_or(false);
                    if !ok {
                        continue;
                    }

                    // Branch create/delete detection (repo-wide).
                    let current_branches: HashSet<String> =
                        git_lines(&project_path, &["branch", "--format=%(refname:short)"])
                            .into_iter()
                            .collect();

                    // Gather latest commit info per session without holding watcher lock.
                    // (session_id, branch, hash, author, message)
                    let mut latest_commits: Vec<(usize, String, String, String, String)> =
                        Vec::new();
                    for (session_id, working_dir) in &sess {
                        let Some(wd) = working_dir.as_deref() else {
                            continue;
                        };

                        let ok = git_output(wd, &["rev-parse", "--is-inside-work-tree"])
                            .map(|v| v == "true")
                            .unwrap_or(false);
                        if !ok {
                            continue;
                        }

                        let hash = git_output(wd, &["rev-parse", "HEAD"]).unwrap_or_default();
                        if hash.is_empty() {
                            continue;
                        }

                        let branch =
                            git_output(wd, &["branch", "--show-current"]).unwrap_or_default();

                        let fmt = "%an%x1f%s";
                        let line = git_output(wd, &["log", "-1", "--format", fmt, "HEAD"])
                            .unwrap_or_default();
                        let parts: Vec<&str> = line.split('\x1f').collect();
                        let author = parts.first().map(|s| s.trim()).unwrap_or("").to_string();
                        let message = parts.get(1).map(|s| s.trim()).unwrap_or("").to_string();

                        latest_commits.push((*session_id, branch, hash, author, message));
                    }

                    let mut events_to_emit: Vec<GitEvent> = Vec::new();

                    let mut state_guard = watcher_for_thread
                        .lock()
                        .expect("git watcher mutex poisoned");
                    let st = state_guard
                        .repo_state
                        .entry(project_path.clone())
                        .or_default();

                    // First sighting: establish baseline without spamming events.
                    if st.branches.is_empty() {
                        st.branches = current_branches;
                    } else {
                        for b in current_branches.difference(&st.branches) {
                            events_to_emit.push(GitEvent {
                                id: new_id("branch-created"),
                                event_type: GitEventType::BranchCreated,
                                timestamp: now_rfc3339(),
                                project_path: project_path.clone(),
                                session_id: None,
                                branch: Some(b.clone()),
                                hash: None,
                                message: None,
                                author: None,
                                base_branch: None,
                                strategy: None,
                                conflict_files: None,
                            });
                        }

                        for b in st.branches.difference(&current_branches) {
                            events_to_emit.push(GitEvent {
                                id: new_id("branch-deleted"),
                                event_type: GitEventType::BranchDeleted,
                                timestamp: now_rfc3339(),
                                project_path: project_path.clone(),
                                session_id: None,
                                branch: Some(b.clone()),
                                hash: None,
                                message: None,
                                author: None,
                                base_branch: None,
                                strategy: None,
                                conflict_files: None,
                            });
                        }

                        st.branches = current_branches;
                    }

                    // Commit events for sessions.
                    for (session_id, branch, hash, author, message) in latest_commits {
                        let prev = st.last_head_by_session.get(&session_id).cloned();
                        if prev.is_none() {
                            // Baseline on first sighting of this session.
                            st.last_head_by_session.insert(session_id, hash.clone());
                            continue;
                        }
                        if prev.as_deref() == Some(hash.as_str()) {
                            continue;
                        }
                        st.last_head_by_session.insert(session_id, hash.clone());

                        events_to_emit.push(GitEvent {
                            id: format!("commit-{hash}"),
                            event_type: GitEventType::Commit,
                            timestamp: now_rfc3339(),
                            project_path: project_path.clone(),
                            session_id: Some(session_id),
                            branch: if branch.trim().is_empty() {
                                None
                            } else {
                                Some(branch)
                            },
                            hash: Some(hash),
                            author: if author.trim().is_empty() {
                                None
                            } else {
                                Some(author)
                            },
                            message: if message.trim().is_empty() {
                                None
                            } else {
                                Some(message)
                            },
                            base_branch: None,
                            strategy: None,
                            conflict_files: None,
                        });
                    }

                    drop(state_guard);
                    for ev in events_to_emit {
                        let _ = app.emit(GIT_EVENT_NAME, ev);
                    }
                }

                thread::sleep(interval);
            }
        }));
    }

    pub fn shutdown(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}
