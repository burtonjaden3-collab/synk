# Execution Plan Tracker

**Priority:** 4
**Inspired by:** OpenAI Harness Engineering — versioned exec-plans as first-class artifacts
**Status:** Spec

---

## Overview

Add a plan management system to Synk. Execution plans are versioned markdown files stored in the project repo, treated as first-class artifacts that agents can read, update, and reference. Synk provides a drawer tab to browse active/completed plans, track progress, and link plans to sessions.

This lets agents pick up where another left off because context lives in the repo, not in chat history.

---

## Decisions

| Question | Answer |
|----------|--------|
| Where do plans live? | `docs/exec-plans/` in the project repo (created if it doesn't exist) |
| Plan format | Markdown with structured frontmatter (YAML) |
| Where does the UI live? | New drawer tab: "Plans" |
| Can agents update plans? | Yes — agents write to the plan file directly; Synk watches for changes |
| Plan lifecycle | draft → active → completed / abandoned |
| Tech debt tracking | Separate `docs/exec-plans/tech-debt-tracker.md` auto-generated |

---

## Plan File Format

```markdown
---
id: plan-2026-02-13-auth-refactor
title: Refactor Authentication System
status: active
created: 2026-02-13T10:30:00Z
updated: 2026-02-13T14:22:00Z
author: jaden
sessions: [session-abc123, session-def456]
tags: [auth, security, refactor]
---

# Refactor Authentication System

## Goal
Replace the current token-based auth with OAuth2 PKCE flow.

## Tasks
- [x] Audit current auth implementation
- [x] Design OAuth2 PKCE flow
- [ ] Implement token exchange endpoint
- [ ] Update frontend auth hooks
- [ ] Add refresh token rotation
- [ ] Write integration tests

## Progress Log
### 2026-02-13 14:22
Completed audit and design. Current auth uses simple JWT with no refresh.
Decision: Use Authorization Code flow with PKCE for public clients.

### 2026-02-13 10:30
Created plan. Starting with audit of existing auth code.

## Decisions
| Decision | Rationale | Date |
|----------|-----------|------|
| OAuth2 PKCE over simple JWT | Better security for desktop apps, standard flow | 2026-02-13 |

## Open Questions
- Should we support multiple OAuth providers or just one?
```

---

## Data Model

### New type: `ExecutionPlan`

```ts
type ExecutionPlan = {
  id: string;                        // From frontmatter
  title: string;
  status: 'draft' | 'active' | 'completed' | 'abandoned';
  filePath: string;                  // Relative path in repo
  createdAt: string;
  updatedAt: string;
  author: string;
  linkedSessionIds: string[];        // Sessions working on this plan
  tags: string[];
  taskCount: number;                 // Total tasks (parsed from markdown checkboxes)
  completedTaskCount: number;        // Checked tasks
  progressPercent: number;           // completedTaskCount / taskCount * 100
};

type TechDebtItem = {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  module: string;                    // Which part of the codebase
  createdAt: string;
  resolvedAt: string | null;
  linkedPlanId: string | null;       // Plan that addresses this debt
};
```

---

## Backend Changes (Rust)

### New module: `src-tauri/src/core/plan_tracker.rs`

- `PlanTracker` struct:
  - Watches `docs/exec-plans/` directory for file changes (using existing notify/watcher)
  - Parses markdown frontmatter for metadata
  - Counts checkbox tasks for progress calculation
- `discover_plans(project_path) -> Vec<ExecutionPlan>`
  - Scans `docs/exec-plans/` for markdown files with valid frontmatter
  - Returns parsed plan metadata
- `create_plan(title, initial_content) -> ExecutionPlan`
  - Creates a new markdown file with generated frontmatter
  - Places in `docs/exec-plans/` (creates directory if needed)
- `update_plan_status(plan_id, new_status)`
  - Updates frontmatter status field
  - If completed, moves to `docs/exec-plans/completed/` subdirectory
- `link_session_to_plan(plan_id, session_id)`
  - Updates frontmatter sessions array
  - Enables agents to reference the plan
- `parse_progress(plan_content) -> (total, completed)`
  - Regex-based checkbox counting: `- [x]` and `- [ ]`
- `get_tech_debt() -> Vec<TechDebtItem>`
  - Parses `docs/exec-plans/tech-debt-tracker.md`

### File watcher integration

- Extend existing file watcher (or add new) to monitor `docs/exec-plans/**/*.md`
- On file change: re-parse the plan, emit event to frontend
- Event: `plan-updated` with plan ID and new metadata

### New commands: `src-tauri/src/commands/plans.rs`

- `list_plans` — returns all discovered plans
- `get_plan` — returns full plan content + metadata
- `create_plan` — creates a new plan file
- `update_plan_status` — change status (active/completed/abandoned)
- `link_session_to_plan` — associate a session with a plan
- `get_tech_debt` — list tech debt items

---

## Frontend Changes

### Drawer Tab: "Plans"

- Tab icon: clipboard or checklist icon
- **Active Plans** section (top):
  - Card per active plan showing: title, progress bar, task count (e.g., "4/7 tasks"), last updated time
  - Click to expand: shows full plan content rendered as markdown
  - "Link Session" button — dropdown to associate a running session
  - "Mark Complete" / "Abandon" actions
- **Completed Plans** section (collapsed by default):
  - List of completed plans with completion date
  - Click to view (read-only)
- **Tech Debt** section (collapsed by default):
  - List of debt items with severity badges
  - "Create Plan" button to create a plan addressing selected debt items
- **"New Plan" button** — opens a modal with:
  - Title input
  - Template selector (blank, feature, bugfix, refactor)
  - Creates the file and opens it for editing

### Session Integration

- When a session is linked to a plan, the session header shows a small plan icon
- Clicking the icon jumps to the plan in the drawer
- When opening a session linked to a plan, the plan content is available as context

### Home Screen

- Dashboard shows: "X active plans, Y% average progress"

---

## Agent Interaction

When a session is linked to a plan, Synk can optionally inject a brief context preamble into the session:

```
[Synk Context] You are working on plan: "Refactor Authentication System"
Current progress: 4/7 tasks complete.
Next unchecked task: "Implement token exchange endpoint"
Plan file: docs/exec-plans/plan-2026-02-13-auth-refactor.md
Update the plan file as you make progress (check off completed tasks, add progress log entries).
```

This is opt-in and configurable per session.

---

## Edge Cases

- Plan file manually edited outside Synk — file watcher picks up changes, re-parses
- Plan file has invalid frontmatter — show parse error, still display raw content
- No `docs/exec-plans/` directory — create it on first plan creation
- Plan with 0 tasks — show "No tasks defined" instead of 0/0 progress bar
- Multiple sessions linked to same plan — all shown, no conflict (they may work on different tasks)
- Plan deleted from filesystem — remove from tracker, show notification

---

## Success Criteria

- [ ] Plans are auto-discovered from `docs/exec-plans/` on project open
- [ ] Progress bars update in real-time as plan files are edited (by humans or agents)
- [ ] Creating a new plan takes <5 seconds and produces a valid markdown file
- [ ] Session-plan linking provides useful context to agents
- [ ] Completed plans are properly archived
- [ ] Tech debt tracker provides an actionable list of known debt
