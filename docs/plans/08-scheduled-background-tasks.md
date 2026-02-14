# Scheduled Background Tasks

**Priority:** 8
**Inspired by:** OpenAI Harness Engineering — recurring "garbage collection" agents for tech debt
**Status:** Spec

---

## Overview

Add a task scheduler to Synk — "cron for agents." Users define recurring tasks that Synk runs in background sessions automatically. Examples: daily doc freshness scans, post-merge quality re-grading, weekly lint violation sweeps. Each task produces a summary and optionally opens a PR or creates a plan.

This is the automation layer that ties together Doc Freshness (priority 6), Quality Score (priority 3), and Project Standards (priority 5) into a self-maintaining system.

---

## Decisions

| Question | Answer |
|----------|--------|
| Where is the UI? | Settings → "Scheduled Tasks" section + drawer "Tasks" tab (shared with Task Monitor) |
| Scheduling system | Cron-like expressions or simple presets (daily, weekly, on-event) |
| What agent runs tasks? | User-configured default agent, or per-task agent selection |
| Output handling | Each run produces a summary stored in `.synk/task-runs/` |
| Event triggers | On project open, after merge, after commit, on schedule |
| Resource limits | Max concurrent background tasks, cost ceiling per task, timeout |

---

## Task Types

### Built-in Tasks

| Task | Trigger | What It Does |
|------|---------|-------------|
| Doc Freshness Scan | Daily / On project open | Runs doc health checker, flags stale docs |
| Quality Score Update | After merge / Weekly | Re-runs quality scoring across all modules |
| Standards Compliance Check | After commit | Scans recent changes against project standards |
| Tech Debt Inventory | Weekly | Scans for TODO/FIXME/HACK, updates tech-debt-tracker.md |
| Dependency Audit | Weekly | Checks for outdated or vulnerable dependencies |

### Custom Tasks

Users can define custom tasks with:
- A name and description
- A prompt template (what the agent should do)
- A trigger (schedule or event)
- An output action (log only, create PR, update file, notify)

---

## Data Model

### New types

```ts
type ScheduledTask = {
  id: string;                        // UUID
  name: string;
  description: string;
  type: 'builtin' | 'custom';
  builtinId?: string;               // For built-in tasks
  prompt?: string;                   // For custom tasks — the agent prompt
  trigger: TaskTrigger;
  agentType: AgentType;             // Which agent to use
  outputAction: 'log' | 'create-pr' | 'update-file' | 'notify';
  outputPath?: string;               // For 'update-file' action
  enabled: boolean;
  costCeiling: number | null;
  timeoutMs: number;                 // Max runtime (default 10 min for builtin, 30 min for custom)
  lastRunAt: string | null;
  lastRunStatus: 'success' | 'error' | 'timeout' | 'ceiling-hit' | null;
  createdAt: string;
};

type TaskTrigger =
  | { type: 'schedule'; cron: string }           // Cron expression
  | { type: 'preset'; preset: 'daily' | 'weekly' | 'hourly' }
  | { type: 'event'; event: 'project-open' | 'after-merge' | 'after-commit' }
  | { type: 'manual' };                          // Run only when user clicks "Run Now"

type TaskRun = {
  id: string;
  taskId: string;
  startedAt: string;
  completedAt: string | null;
  status: 'running' | 'success' | 'error' | 'timeout' | 'ceiling-hit';
  summary: string;                   // Brief summary of what was done
  outputPath: string | null;         // Path to detailed output log
  cost: number;
  sessionId: string;                 // Background session used
};
```

---

## Backend Changes (Rust)

### New module: `src-tauri/src/core/task_scheduler.rs`

- `TaskScheduler` struct:
  - Manages registered tasks and their schedules
  - Runs a background timer that checks for due tasks
  - Spawns background sessions for task execution
  - Tracks run history
- `register_task(task: ScheduledTask)`
  - Adds task to scheduler
  - Sets up timer based on trigger
- `run_task(task_id) -> TaskRun`
  - Creates a background session with the task's agent type
  - Sends the prompt (built-in template or custom)
  - Monitors for completion, timeout, or cost ceiling
  - Captures output summary
  - Executes output action (create PR, update file, etc.)
- `on_event(event_type)` — called by other Synk systems
  - Checks if any tasks are triggered by this event
  - Runs matching tasks
- `get_run_history(task_id, limit) -> Vec<TaskRun>`
  - Returns recent runs for a task

### Event hooks

- After git merge detected: `scheduler.on_event("after-merge")`
- After commit detected: `scheduler.on_event("after-commit")`
- On project open: `scheduler.on_event("project-open")`

### Task persistence

- Tasks stored in `.synk/scheduled-tasks.json`
- Run history stored in `.synk/task-runs/` (one file per run, pruned after 30 days)

### New commands: `src-tauri/src/commands/scheduler.rs`

- `list_scheduled_tasks` — return all tasks
- `create_scheduled_task` — create a new task
- `update_scheduled_task` — modify a task
- `delete_scheduled_task` — remove a task
- `run_task_now` — manually trigger a task
- `get_task_run_history` — get run history for a task
- `enable_task` / `disable_task` — toggle task on/off

---

## Frontend Changes

### Settings → Scheduled Tasks

- **Task list** showing all registered tasks:
  - Name, trigger description, last run time, last status badge
  - Enable/disable toggle per task
  - "Run Now" button
  - Edit/delete actions
- **"Add Task" button** opening a creation form:
  - For built-in: picker of available built-in tasks
  - For custom: name, description, prompt textarea, agent picker, trigger selector, output action
- **Trigger selector:**
  - Presets: "Every day at 6am", "Every Monday", "Every 4 hours"
  - Events: "When I open this project", "After a merge", "After a commit"
  - Manual only
- **Output action selector:**
  - Log only (just record the output)
  - Create PR (agent opens a PR with changes)
  - Update file (agent writes to a specific file)
  - Notify (desktop notification with summary)

### Drawer: Tasks Tab (shared with Task Monitor)

- **Running Tasks** section: shows actively running scheduled tasks alongside monitored long-running tasks
- **Recent Runs** section: last 10 task runs across all tasks
  - Each shows: task name, run time, duration, status badge, cost
  - Click to view full output

---

## Built-in Task Prompts

### Doc Freshness Scan
```
Scan the project documentation for staleness. Check:
1. Any docs not modified in the last 30 days
2. Docs that reference code files which have been modified since the doc
3. Broken markdown links between docs

Report findings as a structured summary. If you find stale docs, list each with what needs updating.
```

### Quality Score Update
```
Analyze the project codebase quality. For each major module/directory:
1. Count test files vs source files (test coverage ratio)
2. Check for files over 500 lines
3. Count TODO/FIXME/HACK comments
4. Check for proper error handling patterns

Output a grade (A-F) per module with specific issues found.
Update .synk/quality-scores.json with the results.
```

### Standards Compliance Check
```
Review the recent git changes against the project standards in .synk/standards.md.
Check the last commit for violations of naming conventions, architecture rules,
code quality rules, and testing requirements.

Report any violations found with file, line, and specific standard violated.
```

---

## Edge Cases

- Synk not running when task is due — run missed tasks on next launch (configurable)
- Multiple tasks triggered simultaneously — queue and run sequentially (or configure max concurrent)
- Task takes longer than timeout — kill session, mark as "timeout", notify user
- Task fails repeatedly — after 3 consecutive failures, auto-disable and notify user
- No agent installed for the configured agent type — skip task, show error in history
- Project not open when scheduled task fires — skip project-specific tasks
- Custom prompt produces unexpected output — capture raw output, don't crash

---

## Success Criteria

- [ ] Built-in tasks work out of the box with zero configuration
- [ ] Custom tasks can be created and tested in under 2 minutes
- [ ] Scheduled tasks fire within 60 seconds of their scheduled time
- [ ] Event-triggered tasks fire within 5 seconds of the event
- [ ] Task run history is browsable and searchable
- [ ] Failed tasks notify the user and don't silently continue failing
- [ ] Cost ceilings are enforced reliably
- [ ] Tasks produce useful, actionable summaries
