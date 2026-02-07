# TASK 4B.1: Task Queue Panel (Frontend)
> Phase 4 — Orchestration | Session B (Frontend) | Depends on: Phase 3 + Task 3B.1

## What to Build
Task queue panel in the bottom drawer's "Task Queue" tab. Create tasks, view queue, drag to reorder priority, show dependency status, dispatch button.

## Priority Formula
`score = (priority × 1000) + (dependencies_ready × 100) + (age_minutes)`

## Deliverables
1. `TaskQueue.tsx` — task list in drawer with columns: title, priority, status, dependencies, assigned agent
2. Create task: title + description + priority (low/medium/high/critical) + dependencies
3. Drag to reorder (overrides priority)
4. Status badges: ⬜ Queued, 🔵 In Progress, ✅ Done, ❌ Blocked (deps not met)
5. Dispatch button: assigns highest-scored unblocked task to an idle agent
6. Zustand store for task state

## Files to Create/Modify
```
src/components/drawer/TaskQueue.tsx (new)
src/lib/store.ts                   (add task queue state)
```

## Acceptance Test
Create 3 tasks with different priorities. They sort by score. Mark one as blocked (dependency on another). Click dispatch → sends top unblocked task to idle agent.

---
## SPEC REFERENCE (Read all of this carefully)
## 21. Task Queue & Dispatch Logic

### 21.1 Task Data Model

```typescript
interface Task {
  id: string;                    // uuid
  title: string;
  description: string;
  status: TaskState;
  priority: 'high' | 'medium' | 'low';
  dependencies: string[];        // task IDs that must complete first
  assignedAgent: number | null;  // session pane index
  branch: string | null;
  orchestratorTaskId: string | null;  // e.g., Gastown bead ID
  createdAt: string;
  updatedAt: string;
  estimatedComplexity: 'small' | 'medium' | 'large';  // for dispatch hinting
}
```

### 21.2 Priority & Ordering

Tasks in the queue are ordered by a **composite score**:

```
score = (priority_weight * 1000) + (dependency_readiness * 100) + (age_minutes)
```

| Factor | Calculation |
|--------|-------------|
| `priority_weight` | high=3, medium=2, low=1 |
| `dependency_readiness` | 1 if all deps are `Done`, 0 if any dep is not `Done` |
| `age_minutes` | Minutes since task was created (older tasks float up within same priority) |

Tasks with `dependency_readiness = 0` are shown in the queue as "Blocked" and cannot be dispatched.

### 21.3 Dependency Graph

Dependencies are simple DAG edges (task A depends on task B). Synk enforces:

1. **No circular dependencies**: When adding a dependency, check for cycles using DFS. Reject if cycle detected.
2. **Cascading blocks**: If task B fails, all tasks depending on B are marked `Blocked`.
3. **Auto-unblock**: When a blocked dependency completes (Done), re-evaluate all tasks that depended on it.
4. **Visual indicator**: Task cards show dependency chain: "Waiting on: [Task A], [Task B]" with click-to-jump.

```
Example dependency graph:

  [Setup DB] ←── [Build Auth] ←── [Build Dashboard]
       ↑              ↑
       └──────── [Seed Data]

Dispatch order (all high priority):
  1. Setup DB (no deps)
  2. Seed Data (no deps)
  3. Build Auth (after Setup DB + Seed Data complete)
  4. Build Dashboard (after Build Auth completes)
```

### 21.4 Auto-Dispatch Algorithm

When a session becomes idle (agent finishes or is killed), Synk's dispatch logic runs:

```
function autoDispatch():
  1. Get list of idle sessions (AgentState == Idle or Finished)
  2. If no idle sessions → return (nothing to dispatch)
  
  3. Get dispatchable tasks:
     - status == Queued
     - dependency_readiness == 1 (all deps Done)
     - sorted by composite score (highest first)
  
  4. If no dispatchable tasks → return
  
  5. For each idle session (in order of session index):
     a. Pick highest-scored dispatchable task
     b. Call orchestrator.dispatch_task(task_id, session_index)
     c. Update task status to Dispatched
     d. Assign task to session
     e. Remove task from dispatchable list
     f. If no more dispatchable tasks → break
  
  6. Emit UI update events
```

**When auto-dispatch triggers:**
- Agent finishes a task (detected via file watcher or output parsing)
- User manually completes/closes a task
- New task is added to queue AND idle sessions exist
- User clicks "Dispatch Next" button

**Auto-dispatch can be disabled** per-project in settings. When disabled, user must manually click "Dispatch" on each task.

### 21.5 Task Queue Panel UI States

| Queue State | UI |
|------------|-----|
| Empty | Centered message: "No tasks. Add one with [+] or generate from blueprint." |
| Has queued tasks, no idle sessions | Tasks shown with status badges. Top banner: "All 4 sessions busy" |
| Has queued tasks, idle sessions available | Pulsing "Dispatch" button on top-priority task. Auto-dispatches if enabled. |
| All tasks done | Celebration micro-animation. Summary stats (time, cost, files changed). |

---


## 6. Bottom Drawer (Draggable Panels)

Resizable drawer that slides up from the bottom. Contains **4 draggable/rearrangeable panels** the user can customize:

### 6.1 Token / Cost Tracker 💰
- Per-session cost display (model, input tokens, output tokens, cost)
- Running total across all sessions
- Cost graph over time (line chart)
- Supports parsing cost output from: Claude Code, Gemini CLI, Codex
- Configurable model pricing (user can update $/token rates)

### 6.2 Git Activity Feed 🔀
- Real-time feed of git events across all sessions:
  - Commits (hash, message, branch, session)
  - Branch creation/deletion
  - Merge events
  - Conflicts detected
- Clickable entries to jump to diff view
- Filter by session or branch

### 6.3 Task Queue / Progress Tracker 📋
- Visual task board (kanban-style or list):
  - **Queued** → **Dispatched** → **In Progress** → **Review** → **Done**
- Each task shows: title, assigned agent, priority, dependencies
- Drag to reorder priority
- Click to expand details
- "Add Task" inline form
- In Gastown mode: maps to convoys/beads
- In Manual mode: simple local task list

### 6.4 Review Queue ✅
- List of agent-completed work ready for human review
- Each item shows: branch name, files changed, additions/deletions
- Click to open full PR-style review:
  - Side-by-side diff viewer
  - Line-level commenting
  - Approve → triggers merge
  - Reject → returns to task queue with comments
  - Request Changes → sends feedback prompt to agent
- Merge strategy selector (merge commit, squash, rebase)
- Conflict detection and warning before merge

---


## 26. Tauri IPC Event Schema

### 26.1 Design Philosophy

All communication between Rust backend and React frontend uses two patterns:
1. **Commands** (frontend → backend): `invoke('command_name', { args })` — request/response
2. **Events** (backend → frontend): `emit('event_name', payload)` — real-time push

Commands are for actions. Events are for state updates.

### 26.2 Commands (Frontend → Backend)

```typescript
// ── Session Management ──────────────────────────────────────

invoke('session:create', {
  agentType: 'claude_code' | 'gemini_cli' | 'codex' | 'terminal',
  projectPath: string,
  branch?: string,
  workingDir?: string,
  env?: Record<string, string>,
}) → { sessionId: number, paneIndex: number }

invoke('session:destroy', { sessionId: number })
  → { success: boolean }

invoke('session:write', { sessionId: number, data: string })
  → void  // fire-and-forget, write to PTY stdin

invoke('session:resize', { sessionId: number, cols: number, rows: number })
  → void

invoke('session:list')
  → SessionInfo[]

// ── Git Operations ──────────────────────────────────────────

invoke('git:create_worktree', {
  sessionId: number,
  branch: string,
  baseBranch?: string,  // default: 'main'
}) → { worktreePath: string, branch: string }

invoke('git:delete_worktree', { sessionId: number })
  → { success: boolean }

invoke('git:diff', {
  branch: string,
  baseBranch: string,
}) → FileDiff[]

invoke('git:merge', {
  branch: string,
  baseBranch: string,
  strategy: 'merge' | 'squash' | 'rebase',
}) → { success: boolean, conflictFiles?: string[] }

invoke('git:branches')
  → string[]

invoke('git:activity', { since?: string })
  → GitEvent[]

// ── Orchestrator ────────────────────────────────────────────

invoke('orchestrator:set_mode', {
  mode: 'gastown' | 'agent_teams' | 'manual' | string,  // string = plugin name
}) → { success: boolean, needsSetup: boolean }

invoke('orchestrator:create_task', { task: TaskDefinition })
  → { taskId: string }

invoke('orchestrator:dispatch_task', { taskId: string, sessionHint?: number })
  → { sessionId: number }

invoke('orchestrator:cancel_task', { taskId: string })
  → { success: boolean }

invoke('orchestrator:list_tasks')
  → TaskStatus[]

invoke('orchestrator:list_agents')
  → AgentStatus[]

invoke('orchestrator:message_agent', { agentId: string, message: string })
  → { success: boolean }

invoke('orchestrator:review_queue')
  → ReviewItem[]

invoke('orchestrator:approve', { taskId: string, strategy: MergeStrategy })
  → { success: boolean }

invoke('orchestrator:reject', { taskId: string, feedback: string })
  → { success: boolean }

// ── AI Provider ─────────────────────────────────────────────

invoke('ai:chat_stream', {
  provider: 'anthropic' | 'google' | 'openai' | 'ollama',
  messages: ChatMessage[],
  systemPrompt: string,
  options?: ChatOptions,
}) → { streamId: string }  // subscribe to events using this ID

invoke('ai:chat_complete', {
  provider: 'anthropic' | 'google' | 'openai' | 'ollama',
  messages: ChatMessage[],
  systemPrompt: string,
  options?: ChatOptions,
}) → { response: string, usage: TokenUsage }

invoke('ai:validate_key', { provider: string, key: string })
  → { valid: boolean, error?: string }

invoke('ai:oauth_start', { provider: string })
  → { authUrl: string }  // open this URL in browser

invoke('ai:oauth_callback', { provider: string, code: string })
  → { success: boolean, email?: string, error?: string }

invoke('ai:oauth_disconnect', { provider: string })
  → { success: boolean }

// ── Skills & MCP ────────────────────────────────────────────

invoke('skills:discover')
  → Skill[]

invoke('skills:toggle', { skillId: string, enabled: boolean, sessionId?: number })
  → { success: boolean }

invoke('mcp:discover')
  → McpServer[]

invoke('mcp:toggle', { serverId: string, enabled: boolean, sessionId?: number })
  → { success: boolean }

invoke('mcp:add', { name: string, command: string, args: string[], env: Record<string, string> })
  → { serverId: string }

// ── Persistence ─────────────────────────────────────────────

invoke('persistence:save_session', { name?: string })
  → { savedPath: string }

invoke('persistence:load_session', { path: string })
  → { sessionCount: number }

invoke('persistence:list_saved')
  → SavedSession[]

// ── Settings ────────────────────────────────────────────────

invoke('settings:get')
  → SynkSettings

invoke('settings:set', { settings: Partial<SynkSettings> })
  → { success: boolean }

// ── Gastown-Specific (only when mode = gastown) ─────────────

invoke('gastown:setup_status')
  → { cliInstalled: boolean, cliVersion?: string, workspaceExists: boolean, rigExists: boolean }

invoke('gastown:run_setup_step', { step: 'install_workspace' | 'add_rig' | 'doctor' | 'doctor_fix' })
  → { output: string, success: boolean }
```

### 26.3 Events (Backend → Frontend)

```typescript
// ── Terminal Output ─────────────────────────────────────────

listen('session:output', {
  sessionId: number,
  data: Uint8Array,         // raw terminal bytes
})  // High frequency — this IS the terminal content

listen('session:exit', {
  sessionId: number,
  exitCode: number,
})

// ── Cost Updates ────────────────────────────────────────────

listen('cost:updated', {
  sessionId: number,
  delta: CostDelta,          // incremental update
  cumulative: CostAccumulator,  // running total for this session
})

// ── Orchestrator Events ─────────────────────────────────────

listen('orchestrator:task_updated', {
  task: TaskStatus,
})

listen('orchestrator:agent_updated', {
  agent: AgentStatus,
})

listen('orchestrator:review_ready', {
  review: ReviewItem,
})

listen('orchestrator:merge_completed', {
  taskId: string,
  branch: string,
  success: boolean,
})

listen('orchestrator:notification', {
  level: 'info' | 'warning' | 'error',
  message: string,
})

// ── Git Events ──────────────────────────────────────────────

listen('git:event', {
  type: 'commit' | 'branch_created' | 'branch_deleted' | 'merge' | 'conflict',
  sessionId: number,
  branch: string,
  details: string,           // commit message, conflict files, etc.
  timestamp: string,
})

// ── AI Streaming ────────────────────────────────────────────

listen('ai:stream_chunk', {
  streamId: string,
  text: string,
})

listen('ai:stream_done', {
  streamId: string,
  usage: TokenUsage,
})

listen('ai:stream_error', {
  streamId: string,
  error: string,
})

// ── Gastown File Watcher ────────────────────────────────────

listen('gastown:state_changed', {
  changeType: 'bead' | 'convoy' | 'polecat' | 'hook' | 'settings',
  entityId: string,
  newState: any,             // parsed JSON from the changed file
})

// ── System ──────────────────────────────────────────────────

listen('pool:status', {
  idle: number,
  active: number,
  total: number,
})

listen('app:error', {
  source: string,            // which subsystem
  message: string,
  recoverable: boolean,
})
```

### 26.4 Event Flow Diagrams

**Creating a new session (command flow):**
```
React                              Rust
  │                                  │
  │ invoke('session:create', {...})   │
  │─────────────────────────────────▶│
  │                                  │ 1. Claim PTY from pool
  │                                  │ 2. cd to project dir
  │                                  │ 3. Start agent command
  │  { sessionId: 3, paneIndex: 2 }  │
  │◀─────────────────────────────────│
  │                                  │
  │  listen('session:output')        │
  │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │ (continuous stream)
  │  listen('session:output')        │
  │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
  │  listen('cost:updated')          │
  │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │ (when cost pattern matched)
  │                                  │
```

**Dispatching a task in Gastown mode:**
```
React                     Rust                          Gastown
  │                         │                              │
  │ invoke('orchestrator:   │                              │
  │   create_task', {...})  │                              │
  │────────────────────────▶│                              │
  │                         │ bd create --title "..."      │
  │                         │─────────────────────────────▶│
  │                         │ (bead ID returned)           │
  │                         │◀─────────────────────────────│
  │  { taskId: "gt-abc12" } │                              │
  │◀────────────────────────│                              │
  │                         │                              │
  │ invoke('orchestrator:   │                              │
  │   dispatch_task', {...})│                              │
  │────────────────────────▶│                              │
  │                         │ gt sling gt-abc12 rig --naked│
  │                         │─────────────────────────────▶│
  │                         │ (process spawned)            │
  │                         │◀─────────────────────────────│
  │                         │                              │
  │                         │ Capture process in PTY pool  │
  │                         │ Emit session:output events   │
  │  { sessionId: 4 }      │                              │
  │◀────────────────────────│                              │
  │                         │                              │
  │  listen('orchestrator:  │   (file watcher detects      │
  │    task_updated')       │    bead status change)       │
  │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
  │                         │                              │
```

---


## 14. File Structure

```
project-root/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs                    # Tauri entry point
│   │   ├── lib.rs                     # Module declarations
│   │   ├── commands/
│   │   │   ├── session.rs             # Session CRUD
│   │   │   ├── git.rs                 # Git/worktree operations
│   │   │   ├── orchestrator.rs        # Orchestrator adapter commands
│   │   │   ├── review.rs              # Diff/merge/review
│   │   │   ├── skills.rs              # Skills discovery/toggle
│   │   │   ├── mcp.rs                 # MCP server management
│   │   │   ├── ai_provider.rs         # AI provider routing
│   │   │   └── persistence.rs         # Save/restore state
│   │   ├── core/
│   │   │   ├── process_pool.rs        # Pre-warmed PTY pool
│   │   │   ├── session_manager.rs     # Session lifecycle
│   │   │   ├── git_manager.rs         # Worktree & merge ops
│   │   │   ├── cost_tracker.rs        # Token/cost parsing
│   │   │   ├── mcp_server.rs          # Built-in MCP status server
│   │   │   ├── skills_discovery.rs    # Auto-detect skills
│   │   │   ├── mcp_discovery.rs       # Auto-detect MCP servers
│   │   │   └── persistence.rs         # Session state storage
│   │   ├── orchestrator/
│   │   │   ├── mod.rs                 # Orchestrator trait/interface
│   │   │   ├── gastown/
│   │   │   │   ├── mod.rs             # Gastown adapter entry
│   │   │   │   ├── cli.rs             # gt/bd CLI executor & output parser
│   │   │   │   ├── file_watcher.rs    # inotify watcher on ~/gt/
│   │   │   │   ├── reconciler.rs      # State reconciler (files → Synk state)
│   │   │   │   ├── setup_wizard.rs    # First-time setup flow
│   │   │   │   └── types.rs           # Gastown data types (Bead, Convoy, Polecat, etc.)
│   │   │   ├── agent_teams.rs         # Claude Agent Teams adapter
│   │   │   └── manual.rs              # Manual/no orchestrator
│   │   ├── ai/
│   │   │   ├── mod.rs                 # AI provider trait
│   │   │   ├── anthropic.rs           # Claude API
│   │   │   ├── google.rs              # Gemini API
│   │   │   ├── openai.rs              # OpenAI API
│   │   │   └── ollama.rs              # Local Ollama
│   │   └── events.rs                  # Tauri event definitions
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── App.tsx                        # Root component + routing
│   ├── components/
│   │   ├── home/
│   │   │   ├── HomeScreen.tsx         # Welcome + recent projects
│   │   │   └── DashboardStats.tsx     # Aggregate stats
│   │   ├── wizard/
│   │   │   ├── BrainstormWizard.tsx   # Full-screen wizard container
│   │   │   ├── ChatBrainstorm.tsx     # Conversational AI chat
│   │   │   ├── BlueprintViewer.tsx    # Mermaid diagram display
│   │   │   ├── BlueprintEditor.tsx    # Manual Mermaid editing
│   │   │   ├── ExportPanel.tsx        # Export options
│   │   │   └── StructuredExtract.tsx  # Real-time data extraction display
│   │   ├── workspace/
│   │   │   ├── Workspace.tsx          # Main workspace layout
│   │   │   ├── SessionGrid.tsx        # Terminal grid
│   │   │   ├── SessionPane.tsx        # Individual terminal pane
│   │   │   └── CommandBar.tsx         # Central command dispatch
│   │   ├── sidebar/
│   │   │   ├── Sidebar.tsx            # Sidebar container
│   │   │   ├── ProjectSelector.tsx    # Project switching
│   │   │   ├── SkillsBrowser.tsx      # Skills toggle list
│   │   │   ├── McpManager.tsx         # MCP server toggles
│   │   │   ├── SessionConfig.tsx      # Per-session settings
│   │   │   ├── OrchestratorControls.tsx # Mode selector + controls
│   │   │   └── AgentStatusOverview.tsx  # Compact status cards
│   │   ├── gastown/
│   │   │   ├── GastownSetupWizard.tsx # First-time setup flow
│   │   │   └── GastownDiagnostics.tsx # gt doctor / health panel
│   │   ├── drawer/
│   │   │   ├── BottomDrawer.tsx       # Drawer container (draggable panels)
│   │   │   ├── CostTracker.tsx        # Token/cost display
│   │   │   ├── GitActivityFeed.tsx    # Real-time git events
│   │   │   ├── TaskQueue.tsx          # Task board (kanban/list)
│   │   │   └── ReviewQueue.tsx        # PR-style review list
│   │   ├── review/
│   │   │   ├── ReviewPanel.tsx        # Full review experience
│   │   │   ├── DiffViewer.tsx         # Side-by-side diff
│   │   │   └── CommentThread.tsx      # Line-level comments
│   │   ├── planner/
│   │   │   └── MermaidFloatingPanel.tsx # Floating project planner
│   │   └── shared/
│   │       ├── KeyboardOverlay.tsx    # Shortcut help
│   │       └── Settings.tsx           # App settings
│   ├── lib/
│   │   ├── store.ts                   # Zustand state store
│   │   ├── tauri-api.ts               # Tauri invoke wrappers
│   │   ├── keybindings.ts             # Vim-style key handler
│   │   ├── cost-calculator.ts         # Token cost logic
│   │   ├── mermaid-utils.ts           # Mermaid generation helpers
│   │   └── types.ts                   # TypeScript interfaces
│   └── styles/
│       └── globals.css                # Tailwind + CSS variables + theme
├── package.json
├── tsconfig.json
├── tailwind.config.js
└── PROJECT_SPEC.md
```

---


