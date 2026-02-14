use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

use anyhow::{bail, Context, Result};

#[derive(Debug, Clone)]
pub struct GitManager {
    project_path: PathBuf,
    worktree_project_root: PathBuf,
    branch_prefix: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    pub path: String,
    pub head: Option<String>,
    pub branch: Option<String>, // e.g. "feat/auth-login"
    pub detached: bool,
    pub locked: bool,
    pub prunable: bool,
    pub is_synk_managed: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanWorktree {
    pub info: WorktreeInfo,
    pub age_seconds: u64,
}

// -----------------------------------------------------------------------------
// Diff model (Task 3A.2)
// -----------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FileDiffStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffLineType {
    Context,
    Addition,
    Deletion,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    #[serde(rename = "type")]
    pub line_type: DiffLineType,
    pub line_number: u32, // line number in the new file
    pub content: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub old_start: u32,
    pub old_count: u32,
    pub new_start: u32,
    pub new_count: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub status: FileDiffStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub old_path: Option<String>,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MergeStrategy {
    Merge,
    Squash,
    Rebase,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conflict_files: Option<Vec<String>>,
}

fn home_dir() -> Result<PathBuf> {
    if let Ok(v) = std::env::var("HOME") {
        if !v.trim().is_empty() {
            return Ok(PathBuf::from(v));
        }
    }
    if let Ok(v) = std::env::var("USERPROFILE") {
        if !v.trim().is_empty() {
            return Ok(PathBuf::from(v));
        }
    }
    bail!("could not determine home directory (missing HOME/USERPROFILE)");
}

fn expand_tilde(s: &str) -> Result<PathBuf> {
    let s = s.trim();
    if s == "~" {
        return home_dir();
    }
    if let Some(rest) = s.strip_prefix("~/") {
        return Ok(home_dir()?.join(rest));
    }
    if let Some(rest) = s.strip_prefix("~\\") {
        return Ok(home_dir()?.join(rest));
    }
    Ok(PathBuf::from(s))
}

fn project_name_from_path(project_path: &Path) -> String {
    project_path
        .file_name()
        .and_then(|s| s.to_str())
        .filter(|s| !s.is_empty())
        .unwrap_or("project")
        .to_string()
}

fn slugify_branch(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;

    for ch in name.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
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
        "branch".to_string()
    } else {
        out
    }
}

fn shell_join(args: &[&str]) -> String {
    args.to_vec().join(" ")
}

fn decode_utf8_lossy(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).trim().to_string()
}

fn strip_prefix_path(s: &str) -> String {
    let s = s.trim();
    if s == "/dev/null" {
        return s.to_string();
    }
    let s = s.strip_prefix("a/").unwrap_or(s);
    let s = s.strip_prefix("b/").unwrap_or(s);
    s.to_string()
}

fn parse_hunk_header(line: &str) -> Option<(u32, u32, u32, u32)> {
    // @@ -old_start,old_count +new_start,new_count @@
    // counts can be omitted: @@ -3 +3 @@
    if !line.starts_with("@@ ") {
        return None;
    }
    let end = line.rfind(" @@")?;
    let body = &line[3..end];
    let mut it = body.split_whitespace();
    let old = it.next()?;
    let new = it.next()?;
    if !old.starts_with('-') || !new.starts_with('+') {
        return None;
    }

    fn parse_range(s: &str) -> Option<(u32, u32)> {
        let s = &s[1..]; // drop +/- prefix
        if let Some((a, b)) = s.split_once(',') {
            Some((a.parse().ok()?, b.parse().ok()?))
        } else {
            Some((s.parse().ok()?, 1))
        }
    }

    let (old_start, old_count) = parse_range(old)?;
    let (new_start, new_count) = parse_range(new)?;
    Some((old_start, old_count, new_start, new_count))
}

fn parse_unified_diff(text: &str) -> Vec<FileDiff> {
    let mut out: Vec<FileDiff> = Vec::new();

    let mut cur_old_path: Option<String> = None;
    let mut cur_new_path: Option<String> = None;
    let mut cur_hunks: Vec<DiffHunk> = Vec::new();
    let mut cur_hunk: Option<DiffHunk> = None;

    // line counters inside current hunk
    let mut old_line: u32 = 0;
    let mut new_line: u32 = 0;

    let flush_hunk = |cur_hunks: &mut Vec<DiffHunk>, cur_hunk: &mut Option<DiffHunk>| {
        if let Some(h) = cur_hunk.take() {
            cur_hunks.push(h);
        }
    };

    let flush_file = |out: &mut Vec<FileDiff>,
                      cur_old_path: &mut Option<String>,
                      cur_new_path: &mut Option<String>,
                      cur_hunks: &mut Vec<DiffHunk>,
                      cur_hunk: &mut Option<DiffHunk>| {
        flush_hunk(cur_hunks, cur_hunk);

        let (Some(oldp), Some(newp)) = (cur_old_path.take(), cur_new_path.take()) else {
            cur_hunks.clear();
            return;
        };

        let old_clean = strip_prefix_path(&oldp);
        let new_clean = strip_prefix_path(&newp);

        let (status, path, old_path) = if old_clean == "/dev/null" && new_clean != "/dev/null" {
            (FileDiffStatus::Added, new_clean, None)
        } else if new_clean == "/dev/null" && old_clean != "/dev/null" {
            (FileDiffStatus::Deleted, old_clean, None)
        } else if old_clean != new_clean {
            (FileDiffStatus::Renamed, new_clean, Some(old_clean))
        } else {
            (FileDiffStatus::Modified, new_clean, None)
        };

        out.push(FileDiff {
            path,
            status,
            old_path,
            hunks: std::mem::take(cur_hunks),
        });
    };

    for line in text.lines() {
        if line.starts_with("diff --git ") {
            flush_file(
                &mut out,
                &mut cur_old_path,
                &mut cur_new_path,
                &mut cur_hunks,
                &mut cur_hunk,
            );
            continue;
        }

        if let Some(v) = line.strip_prefix("--- ") {
            cur_old_path = Some(v.trim().to_string());
            continue;
        }
        if let Some(v) = line.strip_prefix("+++ ") {
            cur_new_path = Some(v.trim().to_string());
            continue;
        }

        if let Some((os, oc, ns, nc)) = parse_hunk_header(line) {
            flush_hunk(&mut cur_hunks, &mut cur_hunk);
            old_line = os;
            new_line = ns;
            cur_hunk = Some(DiffHunk {
                old_start: os,
                old_count: oc,
                new_start: ns,
                new_count: nc,
                lines: Vec::new(),
            });
            continue;
        }

        // Ignore metadata or binary diffs.
        let Some(h) = cur_hunk.as_mut() else {
            continue;
        };

        if line.starts_with('\\') {
            // "\ No newline at end of file"
            continue;
        }

        let (prefix, content) = line.split_at(1);
        match prefix {
            " " => {
                h.lines.push(DiffLine {
                    line_type: DiffLineType::Context,
                    line_number: new_line,
                    content: content.to_string(),
                });
                old_line = old_line.saturating_add(1);
                new_line = new_line.saturating_add(1);
            }
            "+" => {
                h.lines.push(DiffLine {
                    line_type: DiffLineType::Addition,
                    line_number: new_line,
                    content: content.to_string(),
                });
                new_line = new_line.saturating_add(1);
            }
            "-" => {
                h.lines.push(DiffLine {
                    line_type: DiffLineType::Deletion,
                    line_number: new_line,
                    content: content.to_string(),
                });
                old_line = old_line.saturating_add(1);
            }
            _ => {}
        }
    }

    flush_file(
        &mut out,
        &mut cur_old_path,
        &mut cur_new_path,
        &mut cur_hunks,
        &mut cur_hunk,
    );

    out
}

impl GitManager {
    pub fn new(
        project_path: PathBuf,
        worktree_base_path: &str,
        branch_prefix: &str,
    ) -> Result<Self> {
        let base = expand_tilde(worktree_base_path)
            .with_context(|| format!("expand git.worktree_base_path={worktree_base_path:?}"))?;

        let project_name = project_name_from_path(&project_path);
        let worktree_project_root = base.join(slugify_branch(&project_name));

        Ok(Self {
            project_path,
            worktree_project_root,
            branch_prefix: branch_prefix.trim().to_string(),
        })
    }

    pub fn worktree_project_root(&self) -> &Path {
        &self.worktree_project_root
    }

    pub fn normalize_branch(&self, branch: &str) -> Result<String> {
        let b = branch.trim();
        if b.is_empty() {
            bail!("branch is empty");
        }

        // If the caller passed a short slug ("auth-login"), apply the configured prefix.
        // If they passed something that already looks like a namespaced branch ("feat/auth-login"),
        // keep it as-is.
        if b.contains('/') || self.branch_prefix.is_empty() || b.starts_with(&self.branch_prefix) {
            return Ok(b.to_string());
        }

        Ok(format!("{}{}", self.branch_prefix, b))
    }

    fn branch_ref(branch: &str) -> String {
        format!("refs/heads/{branch}")
    }

    fn run_git(&self, args: &[&str]) -> Result<String> {
        let out = Command::new("git")
            .current_dir(&self.project_path)
            .args(args)
            .output()
            .with_context(|| format!("run git {}", shell_join(args)))?;

        if !out.status.success() {
            let stdout = decode_utf8_lossy(&out.stdout);
            let stderr = decode_utf8_lossy(&out.stderr);
            bail!(
                "git {} failed (code={:?})\nstdout: {}\nstderr: {}",
                shell_join(args),
                out.status.code(),
                stdout,
                stderr
            );
        }

        Ok(decode_utf8_lossy(&out.stdout))
    }

    fn run_git_status(&self, args: &[&str]) -> Result<std::process::ExitStatus> {
        Command::new("git")
            .current_dir(&self.project_path)
            .args(args)
            .status()
            .with_context(|| format!("run git {}", shell_join(args)))
    }

    fn branch_exists(&self, branch: &str) -> Result<bool> {
        let r = Command::new("git")
            .current_dir(&self.project_path)
            .args(["show-ref", "--verify", "--quiet", &Self::branch_ref(branch)])
            .status()
            .with_context(|| format!("run git show-ref for branch {branch}"))?;
        Ok(r.success())
    }

    fn rev_exists(&self, rev: &str) -> Result<bool> {
        let rev = rev.trim();
        if rev.is_empty() {
            return Ok(false);
        }
        let spec = format!("{rev}^{{commit}}");
        let r = Command::new("git")
            .current_dir(&self.project_path)
            .args(["rev-parse", "--verify", "--quiet", &spec])
            .status()
            .with_context(|| format!("run git rev-parse --verify {spec}"))?;
        Ok(r.success())
    }

    fn detect_origin_head_branch(&self) -> Option<String> {
        let out = Command::new("git")
            .current_dir(&self.project_path)
            .args(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let s = decode_utf8_lossy(&out.stdout);
        // Example: "refs/remotes/origin/main"
        let name = s.rsplit('/').next()?.trim();
        if name.is_empty() {
            None
        } else {
            Some(name.to_string())
        }
    }

    pub fn default_base_branch(&self) -> Result<String> {
        if self.branch_exists("main")? {
            return Ok("main".to_string());
        }
        if self.branch_exists("master")? {
            return Ok("master".to_string());
        }
        if let Some(origin) = self.detect_origin_head_branch() {
            if self.branch_exists(&origin).unwrap_or(false) {
                return Ok(origin);
            }
        }
        if let Some(cur) = self.current_branch()? {
            if self.branch_exists(&cur).unwrap_or(false) {
                return Ok(cur);
            }
        }
        bail!("could not determine a default base branch (expected main/master or origin/HEAD)");
    }

    pub fn normalize_base_branch(&self, base_branch: &str) -> Result<String> {
        let base = base_branch.trim();
        if base.is_empty() {
            bail!("base_branch is empty");
        }
        if self.branch_exists(base)? {
            return Ok(base.to_string());
        }

        // Common migration path: repo default is still "master" but callers assume "main" (or vice-versa).
        if base == "main" && self.branch_exists("master")? {
            return Ok("master".to_string());
        }
        if base == "master" && self.branch_exists("main")? {
            return Ok("main".to_string());
        }

        // If remote-tracking exists, provide a more actionable error.
        let remote = format!("origin/{base}");
        if self.rev_exists(&remote).unwrap_or(false) {
            bail!(
                "base branch '{base}' does not exist locally. Remote '{remote}' exists. Create a local base branch (e.g. `git switch -c {base} {remote}`) or pick an existing local branch."
            );
        }

        let branches = self.list_branches().unwrap_or_default();
        let preview = branches
            .iter()
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join(", ");
        bail!(
            "base branch '{base}' not found. Local branches (first {}): {}",
            branches.len().min(20),
            preview
        );
    }

    fn ensure_branch(&self, branch: &str, base_branch: &str) -> Result<()> {
        if self.branch_exists(branch)? {
            return Ok(());
        }
        self.run_git(&["branch", branch, base_branch])
            .with_context(|| format!("create branch {branch} from {base_branch}"))?;
        Ok(())
    }

    fn worktree_path_for_branch(&self, branch: &str) -> PathBuf {
        let slug = slugify_branch(branch);
        self.worktree_project_root.join(slug)
    }

    pub fn create_worktree(&self, branch: &str, base_branch: &str) -> Result<(PathBuf, String)> {
        let branch = self.normalize_branch(branch)?;
        let base_branch = self.normalize_base_branch(base_branch)?;

        let wt_path = self.worktree_path_for_branch(&branch);
        if wt_path.exists() {
            // Best-effort: if it already exists, assume it is the intended worktree.
            return Ok((wt_path, branch));
        }

        fs::create_dir_all(&self.worktree_project_root).with_context(|| {
            format!(
                "create worktree root {}",
                self.worktree_project_root.display()
            )
        })?;

        self.ensure_branch(&branch, &base_branch)?;

        self.run_git(&[
            "worktree",
            "add",
            wt_path.to_string_lossy().as_ref(),
            &branch,
        ])
        .with_context(|| format!("git worktree add for branch {branch}"))?;

        Ok((wt_path, branch))
    }

    pub fn remove_worktree(&self, branch: &str) -> Result<()> {
        let branch = self.normalize_branch(branch)?;
        let wt_path = self.worktree_path_for_branch(&branch);

        // Remove the worktree directory (if it exists / is registered).
        // --force is important for cleaning up after crashes or zombie sessions.
        let _ = self.run_git(&[
            "worktree",
            "remove",
            "--force",
            wt_path.to_string_lossy().as_ref(),
        ]);

        // Delete the branch. Prefer safe delete, but fall back to force delete to satisfy
        // the Phase 3A.1 acceptance test (branch may not be merged yet).
        let status = Command::new("git")
            .current_dir(&self.project_path)
            .args(["branch", "-d", &branch])
            .status()
            .with_context(|| format!("run git branch -d {branch}"))?;
        if !status.success() {
            self.run_git(&["branch", "-D", &branch])
                .with_context(|| format!("force delete branch {branch}"))?;
        }

        Ok(())
    }

    pub fn list_worktrees(&self) -> Result<Vec<WorktreeInfo>> {
        let text = self
            .run_git(&["worktree", "list", "--porcelain"])
            .context("git worktree list --porcelain")?;

        #[derive(Default)]
        struct CurrentWorktree {
            path: Option<String>,
            head: Option<String>,
            branch: Option<String>,
            detached: bool,
            locked: bool,
            prunable: bool,
        }

        impl CurrentWorktree {
            fn flush_into(&mut self, out: &mut Vec<WorktreeInfo>, worktree_root: &Path) {
                if let Some(path) = self.path.take() {
                    let is_synk_managed = Path::new(&path).starts_with(worktree_root);
                    out.push(WorktreeInfo {
                        path,
                        head: self.head.take(),
                        branch: self.branch.take(),
                        detached: self.detached,
                        locked: self.locked,
                        prunable: self.prunable,
                        is_synk_managed,
                    });
                }
                self.head = None;
                self.branch = None;
                self.detached = false;
                self.locked = false;
                self.prunable = false;
            }
        }

        let mut out: Vec<WorktreeInfo> = Vec::new();
        let mut current = CurrentWorktree::default();

        for line in text.lines() {
            let line = line.trim_end();
            if line.is_empty() {
                current.flush_into(&mut out, &self.worktree_project_root);
                continue;
            }

            if let Some(v) = line.strip_prefix("worktree ") {
                current.path = Some(v.trim().to_string());
                continue;
            }
            if let Some(v) = line.strip_prefix("HEAD ") {
                current.head = Some(v.trim().to_string());
                continue;
            }
            if let Some(v) = line.strip_prefix("branch ") {
                let raw = v.trim();
                let cleaned = raw.strip_prefix("refs/heads/").unwrap_or(raw).to_string();
                current.branch = Some(cleaned);
                continue;
            }
            if line == "detached" {
                current.detached = true;
                continue;
            }
            if line.starts_with("locked") {
                current.locked = true;
                continue;
            }
            if line.starts_with("prunable") {
                current.prunable = true;
                continue;
            }
        }
        current.flush_into(&mut out, &self.worktree_project_root);

        Ok(out)
    }

    pub fn detect_orphans(
        &self,
        active_worktree_paths: &HashSet<PathBuf>,
        min_age: Duration,
    ) -> Result<Vec<OrphanWorktree>> {
        let list = self.list_worktrees()?;
        let now = SystemTime::now();
        let mut out: Vec<OrphanWorktree> = Vec::new();

        for wt in list {
            if !wt.is_synk_managed {
                continue;
            }
            let path = PathBuf::from(&wt.path);
            if active_worktree_paths.contains(&path) {
                continue;
            }

            let meta = match fs::metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let modified = meta.modified().unwrap_or(now);
            let age = now
                .duration_since(modified)
                .unwrap_or(Duration::from_secs(0));
            if age < min_age {
                continue;
            }

            out.push(OrphanWorktree {
                info: wt,
                age_seconds: age.as_secs(),
            });
        }

        Ok(out)
    }

    pub fn cleanup_orphan(&self, orphan: &OrphanWorktree) -> Result<()> {
        // Removing the worktree is the critical part; branch deletion is best-effort.
        let path = orphan.info.path.as_str();
        self.run_git(&["worktree", "remove", "--force", path])
            .with_context(|| format!("remove orphan worktree {path}"))?;

        if let Some(branch) = orphan.info.branch.as_deref() {
            let _ = self.run_git(&["branch", "-D", branch]);
        }

        Ok(())
    }

    // -------------------------------------------------------------------------
    // Diff / merge (Task 3A.2)
    // -------------------------------------------------------------------------

    pub fn generate_diff(&self, branch: &str, base_branch: &str) -> Result<Vec<FileDiff>> {
        let raw = self.raw_unified_diff(branch, base_branch)?;
        Ok(parse_unified_diff(&raw))
    }

    pub fn raw_unified_diff(&self, branch: &str, base_branch: &str) -> Result<String> {
        let branch = self.normalize_branch(branch)?;
        let base_branch = self.normalize_base_branch(base_branch)?;

        if !self.rev_exists(&branch)? {
            let remote = format!("origin/{branch}");
            if self.rev_exists(&remote).unwrap_or(false) {
                bail!(
                    "feature branch '{branch}' not found locally. Remote '{remote}' exists. Create a local branch (e.g. `git switch -c {branch} {remote}`) or pick an existing local branch."
                );
            }
            let branches = self.list_branches().unwrap_or_default();
            let preview = branches
                .iter()
                .take(20)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
            bail!(
                "feature branch '{branch}' not found. Local branches (first {}): {}",
                branches.len().min(20),
                preview
            );
        }

        self.run_git(&[
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--unified=3",
            &format!("{base_branch}...{branch}"),
        ])
        .with_context(|| format!("git diff {base_branch}...{branch}"))
    }

    fn get_conflict_files_in(&self, cwd: &Path) -> Result<Vec<String>> {
        let out = Command::new("git")
            .current_dir(cwd)
            .args(["diff", "--name-only", "--diff-filter=U"])
            .output()
            .context("git diff --name-only --diff-filter=U")?;
        if !out.status.success() {
            bail!(
                "git diff --name-only --diff-filter=U failed\nstdout: {}\nstderr: {}",
                decode_utf8_lossy(&out.stdout),
                decode_utf8_lossy(&out.stderr)
            );
        }
        let s = String::from_utf8_lossy(&out.stdout);
        let mut files: Vec<String> = s
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect();
        files.sort();
        files.dedup();
        Ok(files)
    }

    #[allow(dead_code)]
    pub fn get_conflict_files(&self) -> Result<Vec<String>> {
        self.get_conflict_files_in(&self.project_path)
    }

    #[allow(dead_code)]
    pub fn detect_conflicts(&self) -> Result<bool> {
        Ok(!self.get_conflict_files()?.is_empty())
    }

    fn current_branch(&self) -> Result<Option<String>> {
        let out = Command::new("git")
            .current_dir(&self.project_path)
            .args(["symbolic-ref", "--quiet", "--short", "HEAD"])
            .output()
            .context("git symbolic-ref --short HEAD")?;
        if out.status.success() {
            let s = decode_utf8_lossy(&out.stdout);
            if s.is_empty() {
                Ok(None)
            } else {
                Ok(Some(s))
            }
        } else {
            Ok(None) // detached or unborn
        }
    }

    fn checkout_branch(&self, branch: &str) -> Result<()> {
        self.run_git(&["checkout", branch])
            .with_context(|| format!("git checkout {branch}"))?;
        Ok(())
    }

    fn find_worktree_for_branch(&self, branch: &str) -> Result<Option<PathBuf>> {
        let want = self.normalize_branch(branch)?;
        for wt in self.list_worktrees()? {
            if wt.branch.as_deref() == Some(want.as_str()) {
                return Ok(Some(PathBuf::from(wt.path)));
            }
        }
        Ok(None)
    }

    pub fn merge_branch(
        &self,
        branch: &str,
        base_branch: &str,
        strategy: MergeStrategy,
    ) -> Result<MergeResult> {
        let branch = self.normalize_branch(branch)?;
        let base_branch = self.normalize_base_branch(base_branch)?;

        if !self.branch_exists(&branch)? {
            let remote = format!("origin/{branch}");
            if self.rev_exists(&remote).unwrap_or(false) {
                bail!(
                    "feature branch '{branch}' not found locally. Remote '{remote}' exists. Create a local branch (e.g. `git switch -c {branch} {remote}`) before merging."
                );
            }
            bail!("feature branch '{branch}' not found locally");
        }

        // Avoid destructive merges if the user has local modifications in the base worktree.
        let dirty = self
            .run_git(&["status", "--porcelain"])
            .context("git status --porcelain")?;
        if !dirty.trim().is_empty() {
            bail!(
                "refusing to merge with a dirty working tree in {}",
                self.project_path.display()
            );
        }

        let orig_branch = self.current_branch()?;

        // Ensure merges apply to base branch.
        if orig_branch.as_deref() != Some(base_branch.as_str()) {
            self.checkout_branch(&base_branch)?;
        }

        let result = match strategy {
            MergeStrategy::Merge => {
                let st = self
                    .run_git_status(&["merge", "--no-ff", &branch])
                    .context("git merge")?;
                if st.success() {
                    MergeResult {
                        success: true,
                        conflict_files: None,
                    }
                } else {
                    let files = self.get_conflict_files_in(&self.project_path)?;
                    // Don't leave the repo in MERGING state.
                    let _ = self.run_git_status(&["merge", "--abort"]);
                    MergeResult {
                        success: false,
                        conflict_files: Some(files),
                    }
                }
            }
            MergeStrategy::Squash => {
                let st = self
                    .run_git_status(&["merge", "--squash", &branch])
                    .context("git merge --squash")?;
                if !st.success() {
                    let files = self.get_conflict_files_in(&self.project_path)?;
                    // Don't leave the repo in MERGING state (squash uses merge machinery).
                    let _ = self.run_git_status(&["merge", "--abort"]);
                    MergeResult {
                        success: false,
                        conflict_files: Some(files),
                    }
                } else {
                    // Use a deterministic message; UI can customize later.
                    self.run_git(&["commit", "-m", &format!("squash: {branch}")])
                        .context("git commit after squash")?;
                    MergeResult {
                        success: true,
                        conflict_files: None,
                    }
                }
            }
            MergeStrategy::Rebase => {
                // Prefer the feature branch's worktree (worktree isolation ON).
                // If we don't have one, fall back to rebasing in the base repo by
                // temporarily checking out the feature branch (worktree isolation OFF).
                let feature_wt = self.find_worktree_for_branch(&branch)?;

                if let Some(dir) = feature_wt {
                    let st = Command::new("git")
                        .current_dir(&dir)
                        .args(["rebase", &base_branch])
                        .status()
                        .with_context(|| {
                            format!("git rebase {base_branch} (in {})", dir.display())
                        })?;
                    if !st.success() {
                        let files = self.get_conflict_files_in(&dir)?;
                        let _ = Command::new("git")
                            .current_dir(&dir)
                            .args(["rebase", "--abort"])
                            .status();
                        return Ok(MergeResult {
                            success: false,
                            conflict_files: Some(files),
                        });
                    }
                } else {
                    // Rebase within the base repo by checking out the feature branch first.
                    if orig_branch.as_deref() != Some(branch.as_str()) {
                        self.checkout_branch(&branch)?;
                    }
                    let st = self
                        .run_git_status(&["rebase", &base_branch])
                        .context("git rebase (in base repo)")?;
                    if !st.success() {
                        let files = self.get_conflict_files_in(&self.project_path)?;
                        let _ = self.run_git_status(&["rebase", "--abort"]);
                        // Best-effort: restore original branch if possible.
                        if let Some(orig) = orig_branch.as_deref() {
                            let _ = self.checkout_branch(orig);
                        }
                        return Ok(MergeResult {
                            success: false,
                            conflict_files: Some(files),
                        });
                    }
                }

                // Ensure merges apply to base branch, then fast-forward.
                let cur = self.current_branch()?;
                if cur.as_deref() != Some(base_branch.as_str()) {
                    self.checkout_branch(&base_branch)?;
                }

                let st = self
                    .run_git_status(&["merge", "--ff-only", &branch])
                    .context("git merge --ff-only after rebase")?;
                if st.success() {
                    MergeResult {
                        success: true,
                        conflict_files: None,
                    }
                } else {
                    let files = self.get_conflict_files_in(&self.project_path)?;
                    MergeResult {
                        success: false,
                        conflict_files: Some(files),
                    }
                }
            }
        };

        // Restore the user's original branch (best-effort). For conflicts we abort above,
        // so checkout should generally be safe.
        if let Some(orig) = orig_branch.as_deref() {
            if self.current_branch().ok().flatten().as_deref() != Some(orig) {
                let _ = self.checkout_branch(orig);
            }
        }

        Ok(result)
    }

    pub fn list_branches(&self) -> Result<Vec<String>> {
        let text = self
            .run_git(&["branch", "--format=%(refname:short)"])
            .context("git branch --format=%(refname:short)")?;
        let mut out: Vec<String> = text
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect();
        out.sort();
        out.dedup();
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::anyhow;
    use std::time::{Duration, UNIX_EPOCH};

    fn unique_tmp_dir(prefix: &str) -> PathBuf {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::from_secs(0))
            .as_nanos();
        std::env::temp_dir().join(format!("{prefix}-{n}"))
    }

    fn git(dir: &Path, args: &[&str]) -> Result<()> {
        let out = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .with_context(|| format!("run git {}", shell_join(args)))?;
        if !out.status.success() {
            return Err(anyhow!(
                "git {} failed\nstdout: {}\nstderr: {}",
                shell_join(args),
                decode_utf8_lossy(&out.stdout),
                decode_utf8_lossy(&out.stderr)
            ));
        }
        Ok(())
    }

    fn git_out(dir: &Path, args: &[&str]) -> Result<String> {
        let out = Command::new("git")
            .current_dir(dir)
            .args(args)
            .output()
            .with_context(|| format!("run git {}", shell_join(args)))?;
        if !out.status.success() {
            return Err(anyhow!(
                "git {} failed\nstdout: {}\nstderr: {}",
                shell_join(args),
                decode_utf8_lossy(&out.stdout),
                decode_utf8_lossy(&out.stderr)
            ));
        }
        Ok(decode_utf8_lossy(&out.stdout))
    }

    fn init_repo(dir: &Path) -> Result<()> {
        fs::create_dir_all(dir).context("create tmp repo dir")?;
        git(dir, &["init", "-b", "main"])?;
        git(dir, &["config", "user.name", "synk"])?;
        git(dir, &["config", "user.email", "synk@example.com"])?;
        fs::write(dir.join("README.md"), "hello\n").context("write README")?;
        git(dir, &["add", "."])?;
        git(dir, &["commit", "-m", "init"])?;
        Ok(())
    }

    #[test]
    fn create_and_remove_worktree_deletes_branch() -> Result<()> {
        let repo = unique_tmp_dir("synk-git-repo");
        let wts = unique_tmp_dir("synk-worktrees");
        init_repo(&repo)?;

        let mgr = GitManager::new(repo.clone(), wts.to_string_lossy().as_ref(), "feat/")?;
        let (path, branch) = mgr.create_worktree("feat/auth", "main")?;
        assert!(path.exists(), "worktree directory should exist");
        assert_eq!(branch, "feat/auth");

        mgr.remove_worktree("feat/auth")?;
        assert!(!path.exists(), "worktree directory should be removed");
        assert!(!mgr.branch_exists("feat/auth")?, "branch should be deleted");
        Ok(())
    }

    #[test]
    fn detect_orphans_ignores_active() -> Result<()> {
        let repo = unique_tmp_dir("synk-git-repo2");
        let wts = unique_tmp_dir("synk-worktrees2");
        init_repo(&repo)?;

        let mgr = GitManager::new(repo.clone(), wts.to_string_lossy().as_ref(), "feat/")?;
        let (path, _) = mgr.create_worktree("feat/orphan", "main")?;

        let mut active = HashSet::new();
        active.insert(path.clone());
        let orphans = mgr.detect_orphans(&active, Duration::from_secs(0))?;
        assert!(orphans.is_empty(), "active worktree should not be orphaned");

        active.clear();
        let orphans = mgr.detect_orphans(&active, Duration::from_secs(0))?;
        assert_eq!(
            orphans.len(),
            1,
            "worktree should be orphaned when inactive"
        );
        Ok(())
    }

    #[test]
    fn generate_diff_returns_structured_file_diffs() -> Result<()> {
        let repo = unique_tmp_dir("synk-git-repo3");
        let wts = unique_tmp_dir("synk-worktrees3");
        init_repo(&repo)?;

        let mgr = GitManager::new(repo.clone(), wts.to_string_lossy().as_ref(), "feat/")?;
        let (wt, _) = mgr.create_worktree("feat/diff", "main")?;

        fs::write(wt.join("README.md"), "hello\nworld\n").context("write README in branch")?;
        git(&wt, &["add", "README.md"])?;
        git(&wt, &["commit", "-m", "add world"])?;

        let diffs = mgr.generate_diff("feat/diff", "main")?;
        assert!(!diffs.is_empty(), "expected at least one FileDiff");

        let readme = diffs
            .iter()
            .find(|d| d.path == "README.md")
            .expect("diff should include README.md");
        assert_eq!(readme.status, FileDiffStatus::Modified);
        assert!(!readme.hunks.is_empty(), "expected hunks for README.md");
        assert!(
            readme
                .hunks
                .iter()
                .flat_map(|h| h.lines.iter())
                .any(|l| l.line_type == DiffLineType::Addition && l.content.contains("world")),
            "expected an addition line containing 'world'"
        );

        Ok(())
    }

    #[test]
    fn squash_merge_creates_single_commit_on_main() -> Result<()> {
        let repo = unique_tmp_dir("synk-git-repo4");
        let wts = unique_tmp_dir("synk-worktrees4");
        init_repo(&repo)?;

        let mgr = GitManager::new(repo.clone(), wts.to_string_lossy().as_ref(), "feat/")?;
        let (wt, _) = mgr.create_worktree("feat/squash", "main")?;

        fs::write(wt.join("a.txt"), "one\n").context("write a.txt")?;
        git(&wt, &["add", "a.txt"])?;
        git(&wt, &["commit", "-m", "add a.txt"])?;

        fs::write(wt.join("b.txt"), "two\n").context("write b.txt")?;
        git(&wt, &["add", "b.txt"])?;
        git(&wt, &["commit", "-m", "add b.txt"])?;

        let before: u32 = git_out(&repo, &["rev-list", "--count", "main"])?
            .parse()
            .unwrap_or(0);
        let res = mgr.merge_branch("feat/squash", "main", MergeStrategy::Squash)?;
        assert!(res.success, "expected squash merge to succeed");

        let after: u32 = git_out(&repo, &["rev-list", "--count", "main"])?
            .parse()
            .unwrap_or(0);
        assert_eq!(after, before + 1, "squash should add exactly 1 commit");
        Ok(())
    }

    #[test]
    fn merge_conflict_returns_conflict_files() -> Result<()> {
        let repo = unique_tmp_dir("synk-git-repo5");
        let wts = unique_tmp_dir("synk-worktrees5");
        init_repo(&repo)?;

        let mgr = GitManager::new(repo.clone(), wts.to_string_lossy().as_ref(), "feat/")?;
        let (wt, _) = mgr.create_worktree("feat/conflict", "main")?;

        fs::write(wt.join("README.md"), "hello from branch\n").context("write README in branch")?;
        git(&wt, &["add", "README.md"])?;
        git(&wt, &["commit", "-m", "branch edit"])?;

        fs::write(repo.join("README.md"), "hello from main\n").context("write README in main")?;
        git(&repo, &["add", "README.md"])?;
        git(&repo, &["commit", "-m", "main edit"])?;

        let res = mgr.merge_branch("feat/conflict", "main", MergeStrategy::Merge)?;
        assert!(!res.success, "expected merge to conflict");
        let files = res.conflict_files.unwrap_or_default();
        assert!(
            files.iter().any(|f| f == "README.md"),
            "expected README.md in conflict files"
        );

        // Clean up merge state so the temp repo can be reused/inspected.
        // merge_branch already attempts `git merge --abort` on failure; keep this best-effort.
        let _ = git(&repo, &["merge", "--abort"]);
        Ok(())
    }
}
