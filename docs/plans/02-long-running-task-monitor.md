# Long-Running Task Monitor

**Priority:** 2
**Inspired by:** OpenAI Harness Engineering — 6+ hour agent sessions running overnight
**Status:** Spec

---

## Overview

Add awareness of long-running agent tasks to Synk. Sessions can run for hours — the monitor tracks duration, cost accumulation, last meaningful output, and sends desktop notifications when tasks complete or error. Users can set cost ceilings per session to prevent runaway spending.

This extends the existing cost tracking (Phase 6B.1) with time and progress awareness.

---

## Decisions

| Question | Answer |
|----------|--------|
| Where does the monitor live? | New drawer tab: "Tasks" — sits alongside Git Feed, Cost, Reviews, Localhost |
| What triggers "task detected"? | Heuristic: session has been producing output for >2 minutes continuously, or user manually marks a session as "long-running" |
| Notifications | Native OS desktop notifications via Tauri's notification API |
| Cost ceilings | Per-session configurable, set from the monitor panel or session config |
| What happens at ceiling? | Session's PTY receives Ctrl+C, user gets notification with summary |

---

## User Flow

1. User kicks off a complex task in Session A (e.g., "refactor the entire auth system")
2. After 2 minutes of continuous agent output, Synk auto-detects this as a long-running task
3. The Tasks drawer tab shows a card for Session A:
   - Session name + agent type badge
   - Duration timer (e.g., "Running for 47m 23s")
   - Token count + cost (e.g., "42.3K tokens — $1.87")
   - Last output summary (last meaningful line, truncated)
   - Progress bar if cost ceiling is set (e.g., "$1.87 / $5.00")
4. User closes laptop and goes to sleep
5. Task completes — Synk sends a desktop notification: "Session A completed — 3h 12m, $4.23"
6. User opens Synk next morning, sees the completed task card with:
   - Total duration and cost
   - Final output summary
   - Link to jump to the session and review the work

---

## Data Model

### New type: `TaskMonitorEntry`

```ts
type TaskMonitorEntry = {
  id: string;                      // UUID
  sessionId: string;               // Linked session
  status: 'active' | 'completed' | 'errored' | 'ceiling-hit' | 'cancelled';
  startedAt: string;               // ISO timestamp
  completedAt: string | null;
  durationMs: number;              // Continuously updated
  tokenCount: number;              // From cost tracker
  estimatedCost: number;           // From cost tracker
  costCeiling: number | null;      // User-configured max spend
  lastOutput: string;              // Last meaningful output line (max 200 chars)
  lastOutputAt: string;            // When the last output was captured
  idleThresholdMs: number;         // How long without output before marking "idle" (default 60s)
  isIdle: boolean;                 // True if no output for idleThresholdMs
  notificationSent: boolean;       // Whether completion notification was sent
};
```

### Settings additions

```ts
// Add to existing Settings type
taskMonitor: {
  autoDetect: boolean;             // Auto-detect long-running tasks (default true)
  autoDetectThresholdMs: number;   // Duration before auto-detect triggers (default 120000 = 2 min)
  defaultCostCeiling: number | null; // Default cost ceiling for new tasks (default null = unlimited)
  notifyOnComplete: boolean;       // Desktop notification on completion (default true)
  notifyOnError: boolean;          // Desktop notification on error (default true)
  notifyOnCeiling: boolean;        // Desktop notification on cost ceiling (default true)
  idleThresholdMs: number;         // Idle detection threshold (default 60000 = 1 min)
};
```

---

## Backend Changes (Rust)

### New module: `src-tauri/src/core/task_monitor.rs`

- `TaskMonitor` struct with:
  - `entries: HashMap<String, TaskMonitorEntry>` — active and recent entries
  - Integration with existing `CostTracker` for real-time cost data
  - Integration with `SessionManager` for session lifecycle events
- `detect_long_running(session_id)` — called periodically, checks if session output duration exceeds threshold
- `start_monitoring(session_id, cost_ceiling)` — manually start monitoring a session
- `update_entry(session_id, output_line)` — called on each PTY output, updates last output and cost
- `check_cost_ceiling(session_id)` — checks if cost exceeds ceiling, sends Ctrl+C if so
- `on_session_idle(session_id)` — triggered when output stops, sends notification
- `on_session_complete(session_id)` — marks entry complete, sends notification

### Notification integration

- Use Tauri's `tauri-plugin-notification` for native OS notifications
- Notification payload includes: session name, duration, cost, completion status
- Clicking the notification brings Synk to foreground and focuses the session

### New commands: `src-tauri/src/commands/task_monitor.rs`

- `get_monitored_tasks` — list all active + recent task entries
- `start_task_monitor` — manually start monitoring a session
- `stop_task_monitor` — stop monitoring (doesn't kill the session)
- `set_cost_ceiling` — set/update cost ceiling for a monitored session
- `dismiss_task` — remove a completed/errored task from the list

---

## Frontend Changes

### Drawer Tab: "Tasks"

- Tab icon: clock or hourglass
- Empty state: "No long-running tasks detected. Tasks appear here when sessions run for over 2 minutes."
- Active task cards show:
  - **Header:** Session name + agent badge + status pill (Active/Idle/Complete/Error)
  - **Timer:** Live duration counter "2h 34m 12s"
  - **Cost:** "$3.42" with model name
  - **Cost bar:** Progress bar if ceiling set, turns yellow at 80%, red at 95%
  - **Last output:** Truncated last meaningful line, monospace font
  - **Actions:** "Set Ceiling" button, "Cancel" button, "Jump to Session" link
- Completed task cards are dimmed, show final stats, and can be dismissed

### Session Grid Integration

- Sessions with active task monitoring show a small clock icon in the session header
- Session border gets a subtle pulse animation when actively producing output

### Settings Panel

- New "Task Monitor" section under existing settings
- Toggle: Auto-detect long-running tasks
- Threshold slider: Minutes before auto-detect (1-10 min, default 2)
- Default cost ceiling input
- Notification toggles (complete, error, ceiling)

---

## Edge Cases

- Session produces output in bursts with gaps — use idle threshold to distinguish "thinking" from "done"
- Multiple sessions running long tasks simultaneously — show all in the Tasks tab, sort by start time
- Session crashes (PTY dies) — mark as "errored", send notification, preserve stats
- App restart during long-running task — restore task monitor state from persistence
- Cost tracker not parsing output for an agent type — show duration only, cost as "N/A"
- User sets cost ceiling to $0 — reject with validation error

---

## Success Criteria

- [ ] Long-running tasks are auto-detected within 10 seconds of crossing the threshold
- [ ] Duration and cost update in real-time (at least every 5 seconds)
- [ ] Desktop notifications fire within 5 seconds of task completion/error
- [ ] Cost ceiling enforcement kills the session promptly (within 10 seconds)
- [ ] Task monitor state survives app restart
- [ ] Multiple simultaneous monitored tasks display correctly
