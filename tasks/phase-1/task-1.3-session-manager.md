# TASK 1.3: Session Manager + IPC
> Phase 1 — Foundation | Single Session | Depends on: Task 1.2

## What to Build
Session CRUD: create session (claims from PTY pool), write to PTY stdin, read PTY stdout via events, resize, destroy. Wire up Tauri IPC commands and events for terminal I/O.

## Deliverables
1. `session_manager.rs` — full implementation: create, write, resize, kill, list sessions
2. `commands/session.rs` — Tauri command handlers wrapping the session manager
3. `events.rs` — event type definitions for session:output and session:exit
4. Session output streaming: PTY stdout → Tauri event → frontend receives bytes
5. Max 12 concurrent sessions enforced

## Files to Create/Modify
```
src-tauri/src/core/session_manager.rs (implement fully)
src-tauri/src/commands/session.rs     (new — Tauri #[command] functions)
src-tauri/src/commands/mod.rs         (module declarations)
src-tauri/src/events.rs               (new — event type definitions)
src-tauri/src/lib.rs                  (register commands with tauri::Builder)
```

## Acceptance Test
Frontend invokes `session:create` → gets session ID back. Invoke `session:write` with text → receive `session:output` event with shell response. Create 12 sessions, try 13th → get max sessions error.

---
## SPEC REFERENCE (Read all of this carefully)
## 8. Terminal & Session Management

### 8.1 Session Grid Layout
- Equal-sized panes in responsive grid (tmux-style)
- Auto-reflows based on session count. **Notation:** `cols×rows` (e.g. `2×1` = 2 columns side-by-side).

| Sessions | Layout |
|----------|--------|
| 1 | 1×1 |
| 2 | 2×1 |
| 3-4 | 2×2 |
| 5-6 | 3×2 |
| 7-9 | 3×3 |
| 10-12 | 4×3 |

- Max 12 simultaneous sessions
- Each pane header shows: agent type badge, branch name, status dot, session cost

### 8.2 Supported Agents

| Agent | Command | Detection |
|-------|---------|-----------|
| Claude Code | `claude` | `which claude` |
| Gemini CLI | `gemini` | `which gemini` |
| OpenAI Codex | `codex` | `which codex` |
| Plain Terminal | `$SHELL` | Always available |

### 8.3 Interaction Modes
- **Direct input**: Click a pane → type directly into the terminal
- **Central command bar**: `/` to open → type prompt → select target session(s) → dispatch
- **Broadcast**: `Ctrl+b` → next prompt goes to ALL sessions

### 8.4 Startup Optimization (Critical — Solving the Original Lag)
| Technique | Description |
|-----------|-------------|
| **Pre-warmed process pool** | On app launch, pre-spawn 2-4 idle PTY shells in the background |
| **Lazy terminal rendering** | Only attach xterm.js to visible panes; off-screen panes buffer output |
| **Staggered launch** | When launching multiple sessions, stagger by ~100ms to avoid I/O thundering herd |
| **Session recycling** | On close, return PTY to pool instead of killing (optional) |

### 8.5 Session Persistence
- **Save session**: Snapshot layout, agent types, branches, task queue state
- **Restore session**: Reload layout, reconnect to project (agents restart fresh)
- **Auto-save option**: Periodic state save for crash recovery
- **User choice**: On close, prompt "Save session for later?" (optional, not forced)
- Stored in `~/.config/synk/sessions/`

---


## 26. Tauri IPC Event Schema

### 26.1 Design Philosophy

All communication between Rust backend and React frontend uses two patterns:
1. **Commands** (frontend → backend): `invoke('command_name', { args })` — request/response
2. **Events** (backend → frontend): `emit('event_name', payload)` — real-time push

Commands are for actions. Events are for state updates.

**Phase 1 scope:** implement only the `session:*` commands and `session:*` events required for terminal I/O. The non-session schemas below are future reference and should not be implemented as part of Phase 1.

### 26.2 Commands (Frontend → Backend)

```typescript
// ── Session Management ──────────────────────────────────────

invoke('session:create', {
  // Wire format is camelCase; backend can use serde rename/aliases.
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
  // Phase 1 decision:
  // Use base64 to avoid "Vec<u8> serialized as huge JSON number[]".
  dataB64: string,          // base64 of raw terminal bytes
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


## 22. PTY Process Pool — Implementation Detail

### 22.1 Pool Architecture

```rust
pub struct ProcessPool {
    idle_pool: Vec<PtyHandle>,       // pre-warmed, waiting to be claimed
    active: HashMap<usize, PtyHandle>, // session_index → handle
    config: PoolConfig,
    recycler_tx: mpsc::Sender<PtyHandle>,  // channel for returning PTYs
}

pub struct PtyHandle {
    pid: u32,
    master_fd: OwnedFd,             // PTY master file descriptor
    child: Child,                    // tokio child process handle
    shell: String,                   // e.g., "/bin/bash"
    created_at: Instant,
    state: PtyState,
}

pub enum PtyState {
    Warming,   // just spawned, running shell init
    Idle,      // in pool, ready to claim
    Active,    // assigned to a session
    Recycling, // being cleaned for reuse
    Dead,      // process exited
}

pub struct PoolConfig {
    pub initial_pool_size: usize,    // default: 2
    pub max_pool_size: usize,        // default: 4
    pub max_active: usize,           // default: 12 (grid max)
    pub recycle_enabled: bool,       // default: true
    pub max_pty_age: Duration,       // default: 30 minutes (before forced recycle)
    pub warmup_delay: Duration,      // default: 100ms between spawns
}
```

### 22.2 Lifecycle

```
App Launch
    │
    ▼
Spawn initial_pool_size PTYs (staggered by warmup_delay)
    │  Each: fork() → exec($SHELL) → wait for shell prompt
    │  State: Warming → Idle
    ▼
Pool ready (2-4 idle PTYs)
    │
    ├── User creates new session ──────────────────────────────┐
    │   1. Claim idle PTY from pool (FIFO)                     │
    │   2. cd to project directory                             │
    │   3. Set env vars (SYNK_SESSION=n, SYNK_PROJECT=...)     │
    │   4. If agent mode: exec agent command (replaces shell)  │
    │   5. State: Idle → Active                                │
    │   6. If pool < initial_pool_size: spawn replacement      │
    │   Return: PtyHandle to session_manager                   │
    │                                                          │
    ├── User closes session ───────────────────────────────────┤
    │   If recycle_enabled AND pty_age < max_pty_age:          │
    │     1. Send Ctrl+C, wait 500ms                           │
    │     2. Send `cd ~ && clear && reset`                     │
    │     3. Verify shell prompt appears (within 2s timeout)   │
    │     4. If healthy: State → Idle, return to pool          │
    │     5. If unhealthy: kill and spawn fresh                │
    │   Else:                                                  │
    │     1. Kill process (SIGTERM, then SIGKILL after 3s)     │
    │     2. Close file descriptors                            │
    │     3. Spawn replacement if pool < initial_pool_size     │
    │                                                          │
    ├── Pool exhausted (all claimed, none idle) ───────────────┤
    │   1. If active < max_active: spawn on-demand (no pool)   │
    │      → slightly slower (~200ms extra) but still works    │
    │   2. If active == max_active: return error               │
    │      → UI shows "Max sessions reached (12)"              │
    │                                                          │
    └── App shutdown ──────────────────────────────────────────┘
        1. Send SIGTERM to all active PTYs
        2. Wait 3s for graceful exit
        3. SIGKILL any remaining
        4. Close all file descriptors
```

### 22.3 Warm-Up Strategy

Why pre-warming matters: shell startup (~150-400ms for bash with .bashrc) is the single biggest contributor to perceived "lag" when opening a new session. By doing it ahead of time, the user sees instant response.

**What happens during warm-up:**
1. `forkpty()` creates a pseudo-terminal pair
2. Child process `exec("/bin/bash", ["--login"])` (or `$SHELL`)
3. Shell reads `.bashrc`, `.profile`, etc.
4. Synk watches the PTY output for a shell prompt pattern (configurable regex, default: `\$\s*$`)
5. Once prompt detected → State: `Warming` → `Idle`
6. If prompt not detected within 5s → kill and retry (shell config may be broken)

**Pool refill logic:**
- After claiming a PTY, if `idle_pool.len() < initial_pool_size`, spawn a replacement in the background
- Spawn delay: 100ms after the claim (avoid I/O contention with the session that just started)

### 22.4 Tuning Guidance

| System | Recommended `initial_pool_size` | Recommended `max_pool_size` |
|--------|--------------------------------|----------------------------|
| 8GB RAM, 4 cores | 2 | 3 |
| 16GB RAM, 8 cores | 3 | 4 |
| 32GB+ RAM, 12+ cores | 4 | 6 |

Each idle PTY consumes ~5-10MB RAM (bash process + terminal buffer). Active sessions with AI agents consume 30-50MB.

Settings UI exposes these as sliders under "Performance" → "Process Pool" with a real-time RAM estimate.

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
