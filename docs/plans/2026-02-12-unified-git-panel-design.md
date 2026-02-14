# Unified Git Panel — Replace Git Activity Tab

## Goal

Replace the existing "Git Activity" bottom drawer tab with a unified panel that combines:
1. A Maestro-style commit log (graph + commit rows + detail panel)
2. The existing live event feed (commits, branches, merges, conflicts)

The current `GitActivityFeed.tsx` is a real-time event stream only — no `git log` history, no file change details, no graph. This feature merges both into one panel.

---

## Reference Implementation

Study Maestro at `~/maestro/` — specifically these files:

### Frontend (React)
- `~/maestro/src/components/git/CommitGraph.tsx` — main graph container, infinite scroll, visibility-aware ref loading
- `~/maestro/src/components/git/CommitRow.tsx` — single commit row: colored SVG dot, branch/tag badges, message, short hash, relative time
- `~/maestro/src/components/git/CommitDetailPanel.tsx` — right-side detail: full SHA (copy button), author, date, message, parent hashes, files changed grouped by directory with A/M/D/R/C status icons, actions (create branch, checkout)
- `~/maestro/src/components/git/GraphCanvas.tsx` — SVG layer drawing bezier connection lines between commits
- `~/maestro/src/lib/graphLayout.ts` — column assignment algorithm, rail colors, connection types (straight/mergeLeft/mergeRight)
- `~/maestro/src/stores/useGitStore.ts` — Zustand store: commits, refs cache, fetchCommits, loadMoreCommits, getCommitFiles, getRefsForCommit

### Backend (Rust)
- `~/maestro/src-tauri/src/commands/git.rs` — Tauri commands:
  - `git_commit_log(repo_path, max_count, all_branches)` → `Vec<CommitInfo>`
  - `git_commit_files(repo_path, commit_hash)` → `Vec<FileChange>`
  - `git_refs_for_commit(repo_path, commit_hash)` → `Vec<String>`
- `~/maestro/src-tauri/src/git/ops.rs` — Git CLI wrappers:
  - `CommitInfo { hash, short_hash, parent_hashes, author_name, author_email, timestamp, summary }`
  - `FileChange { path, status, old_path }`
  - `FileChangeStatus { Added, Modified, Deleted, Renamed, Copied }`

---

## What Synk Has Today

### Bottom Drawer (`src/components/drawer/BottomDrawer.tsx`)
- 4 tabs: Cost Tracker, **Git Activity**, Localhost, Review Queue
- Tab system with drag-to-reorder, resizable height (140–700px), collapsible (Ctrl+J)
- Panel IDs: `"cost" | "git" | "localhost" | "reviews"`

### Git Activity Feed (`src/components/drawer/GitActivityFeed.tsx`)
- Listens to `git:event` Tauri events via `onGitEvent()`
- Stores events in Zustand: `gitEventsByProject` (max 400 per project)
- Shows live events as a scrollable list with auto-scroll
- Right-side detail panel (340px, hidden on small screens) shows raw event fields
- Diff section is a placeholder

### Backend — What Exists
- `src-tauri/src/commands/git.rs` — worktree CRUD, branch listing, orphan detection. **No commit log, no commit files, no refs resolution.**
- `src-tauri/src/core/git_events.rs` — polls every 1500ms, emits `git:event` with type/hash/message/author/branch
- `src-tauri/src/core/git_manager.rs` — worktree operations only

### Types (`src/lib/types.ts`)
- `GitEvent { id, eventType, timestamp, projectPath, sessionId?, branch?, hash?, message?, author?, baseBranch?, strategy?, conflictFiles? }`
- `GitEventType = "commit" | "branch_created" | "branch_deleted" | "merge_completed" | "conflict_detected"`

### Frontend API (`src/lib/tauri-api.ts`)
- Git functions: `gitCreateWorktree`, `gitEnsureWorktree`, `gitRemoveWorktree`, `gitListWorktrees`, `gitDetectOrphans`, `gitCleanupOrphans`, `gitBranches`, `gitDiff`, `gitMerge`
- **No `gitCommitLog`, `gitCommitFiles`, or `gitRefsForCommit`**

---

## Implementation Plan

### 1. Rust Backend — Add 3 Tauri Commands

Add to `src-tauri/src/commands/git.rs` (or a new `git_log.rs` module):

**`git_commit_log`**
- Args: `project_path: String, max_count: usize, skip: usize, branch: Option<String>`
- Runs: `git log --format=<format> --topo-order [--all | branch] -n max_count --skip=skip`
- Returns: `Vec<CommitInfo>` with `{ hash, shortHash, parentHashes, authorName, authorEmail, timestamp, summary }`
- Use `%H%n%h%n%P%n%an%n%ae%n%at%n%s` format for easy parsing (newline-delimited fields, `---` between commits)

**`git_commit_files`**
- Args: `project_path: String, commit_hash: String`
- Runs: `git diff-tree --no-commit-id -r --name-status <hash>`
- Returns: `Vec<FileChange>` with `{ path, status, oldPath? }`

**`git_refs_for_commit`**
- Args: `project_path: String, commit_hash: String`
- Runs: `git for-each-ref --points-at=<hash> --format=%(refname:short)`
- Returns: `Vec<String>` (branch and tag names)

Register all three in `src-tauri/src/lib.rs` invoke_handler.

### 2. Frontend API — Wire Up Commands

Add to `src/lib/tauri-api.ts`:
```ts
gitCommitLog(projectPath: string, maxCount: number, skip?: number, branch?: string): Promise<CommitInfo[]>
gitCommitFiles(projectPath: string, commitHash: string): Promise<FileChange[]>
gitRefsForCommit(projectPath: string, commitHash: string): Promise<string[]>
```

Add to `src/lib/types.ts`:
```ts
interface CommitInfo {
  hash: string;
  shortHash: string;
  parentHashes: string[];
  authorName: string;
  authorEmail: string;
  timestamp: number; // unix seconds
  summary: string;
}

interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied";
  oldPath?: string;
}
```

### 3. Graph Layout — Port from Maestro

Copy `~/maestro/src/lib/graphLayout.ts` to `src/lib/graphLayout.ts`. It's self-contained (only depends on `CommitInfo` type). Adapt the import to use Synk's `CommitInfo` type.

Exports needed: `layoutGraph()`, `GraphNode`, `Rail`, `RAIL_COLORS`, `getRailColor`.

### 4. Replace GitActivityFeed with UnifiedGitPanel

Create `src/components/drawer/UnifiedGitPanel.tsx` — replaces `GitActivityFeed.tsx`.

**Layout (two view modes toggled by segmented control):**

```
┌─────────────────────────────────────────────────────────┐
│ [Commit Log] [Live Events]    branch: main ▾   Refresh  │
├─────────────────────────────────────────────────────────┤
│                                    │                     │
│  Graph | Message | Hash | Time     │  Commit Details     │
│  ● feat: add auth      a1b2c3 2h  │  SHA: a1b2c3...     │
│  ● fix: typo            d4e5f6 3h  │  Author: ...        │
│  ⊙ Merge: feat → main  g7h8i9 1d  │  Files Changed (4)  │
│  ● init project         j0k1l2 2d  │    src/             │
│  ...infinite scroll...             │      +App.tsx       │
│                                    │      ~index.ts      │
│                                    │    lib/             │
│                                    │      +utils.ts      │
└────────────────────────────────────┴─────────────────────┘
```

**Commit Log view:**
- Fetches `gitCommitLog(projectPath, 50, 0, "main")` on mount
- Uses `layoutGraph()` for graph positioning
- `CommitRow` component (adapt from Maestro): SVG dot, branch badges, message, short hash, relative time
- `GraphCanvas` component (adapt from Maestro): SVG connection lines
- Click a row → load `gitCommitFiles()` and `gitRefsForCommit()` → show in detail panel
- Infinite scroll: when near bottom, `gitCommitLog(projectPath, 50, currentOffset)`
- Branch selector dropdown (from `gitBranches()`) — defaults to main/master

**Live Events view:**
- Keep the existing `GitActivityFeed` logic (Zustand events, auto-scroll, clear button)
- This is the same as today but accessed via the toggle

**Detail panel (right side, ~300px):**
- Adapt `CommitDetailPanel` from Maestro
- Shows: full SHA + copy, author + email, date, message, parent hashes, files grouped by directory with status badges
- No "Create branch" or "Checkout" actions for now (keep it read-only)

### 5. Update BottomDrawer

In `BottomDrawer.tsx`:
- Replace `<GitActivityFeed>` import/render with `<UnifiedGitPanel>`
- Update the panel definition: change hint to "Commit history and live events"
- No changes to tab system, drag-to-reorder, or resize behavior

### 6. Zustand Updates

Add to `src/lib/store.ts` (or new slice):
- `commits: CommitInfo[]`
- `commitsLoading: boolean`
- `commitsHasMore: boolean`
- `selectedCommitHash: string | null`
- `commitFiles: Map<string, FileChange[]>` (cache)
- `commitRefs: Map<string, string[]>` (cache)
- `gitPanelView: "log" | "events"` (toggle state)

Keep existing `gitEventsByProject` for the live events view.

---

## Files to Create/Modify

**Create:**
- `src-tauri/src/commands/git_log.rs` (or add to existing `git.rs`)
- `src/lib/graphLayout.ts` (port from Maestro)
- `src/components/drawer/UnifiedGitPanel.tsx`
- `src/components/drawer/CommitRow.tsx`
- `src/components/drawer/CommitDetailPanel.tsx`
- `src/components/drawer/GraphCanvas.tsx`

**Modify:**
- `src-tauri/src/lib.rs` — register new commands
- `src/lib/tauri-api.ts` — add 3 new functions
- `src/lib/types.ts` — add `CommitInfo`, `FileChange` types
- `src/lib/store.ts` — add commit log state
- `src/components/drawer/BottomDrawer.tsx` — swap GitActivityFeed → UnifiedGitPanel

**Delete (after migration):**
- `src/components/drawer/GitActivityFeed.tsx` — logic moves into UnifiedGitPanel's "Live Events" view

---

## Styling Notes

- Use Synk's existing design tokens (`bg-bg-primary`, `text-text-primary`, `border-border`, `accent-blue`, etc.)
- Do NOT use Maestro's `maestro-*` color classes
- Match the density of existing drawer panels (12px padding, 11-12px text, monospace for hashes)
- Graph rail colors: use Maestro's `RAIL_COLORS` palette — it works on dark backgrounds

---

## Out of Scope

- GitHub PRs/Issues/Discussions tabs (Maestro has these, skip for now)
- "Create branch" / "Checkout" actions from detail panel
- Diff viewer inline in the detail panel (files list only, not full diffs)
- Replacing the separate Review Queue tab
