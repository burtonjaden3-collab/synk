# TASK 4A.1: Gastown CLI Executor (Backend)
> Phase 4 — Orchestration | Session A (Gastown Backend) | Depends on: Phase 3

## What to Build
Rust wrapper around Gastown CLI commands (gt, bd). Parse output. Execute commands in visible PTY panes so the user sees everything.

## Core Commands to Wrap
```
bd create --title "..." --description "..." --prefix {rig}  → returns bead ID
bd status {bead-id}                                          → returns status
gt sling {bead-id}                                           → dispatches bead
gt refinery approve {bead-id}                                → approves in refinery
gt convoy create "name" {bead-ids...}                        → creates convoy
gt doctor                                                    → health check
```

## Critical Design Rule
ALL gt/bd commands MUST run in a visible PTY pane (not in background). The user should see every command Synk executes. This is core to the "Synk is a command center, not a black box" philosophy.

## Deliverables
1. `orchestrator/mod.rs` — implement OrchestratorAdapter trait
2. `orchestrator/gastown/cli.rs` — GastownCli struct wrapping command execution
3. `orchestrator/gastown/types.rs` — Gastown-specific types (Bead, Convoy, Rig)
4. Output parsing: extract bead IDs, status, errors from gt/bd stdout
5. Error handling: detect common failures (workspace not found, rig not added, CLI missing)

## Files to Create/Modify
```
src-tauri/src/orchestrator/mod.rs              (implement adapter trait)
src-tauri/src/orchestrator/gastown/mod.rs      (new)
src-tauri/src/orchestrator/gastown/cli.rs      (new)
src-tauri/src/orchestrator/gastown/types.rs    (new)
```

## Acceptance Test
Execute `bd create` via Synk → bead created, ID captured. `gt sling` → bead dispatched. All commands visible in terminal pane. Missing CLI → graceful error.

---
## SPEC REFERENCE (Read all of this carefully)
## 15. Gastown Integration Architecture

### 15.1 Integration Strategy: Medium Depth

**Reads:** File system watching on `~/gt/` directory for real-time state (bead status, convoy progress, polecat lifecycle, hook state). Falls back to CLI parsing (`gt convoy list --json`, `bd list --json`) if file structure changes.

**Writes:** All mutations go through `gt` and `bd` CLI commands. Synk never writes directly to Gastown's file system.

```
┌─────────────────────────────────────────────────────────────────┐
│                          SYNK                                   │
│                                                                 │
│  ┌──────────────────┐         ┌──────────────────────────────┐ │
│  │ File Watcher     │◀───────▶│ ~/gt/ (Gastown workspace)    │ │
│  │ (inotify/notify) │  reads  │  ├── .beads/ (bead ledger)   │ │
│  │                  │         │  ├── <rig>/                   │ │
│  │ Watches:         │         │  │   ├── polecats/            │ │
│  │  • bead changes  │         │  │   ├── hooks/               │ │
│  │  • convoy state  │         │  │   ├── crew/                │ │
│  │  • polecat dirs  │         │  │   └── settings/            │ │
│  │  • hook updates  │         │  └── .gt/ (config)            │ │
│  └────────┬─────────┘         └──────────────────────────────┘ │
│           │                                                     │
│           │ events                                              │
│           ▼                                                     │
│  ┌──────────────────┐         ┌──────────────────────────────┐ │
│  │ State Reconciler │────────▶│ Synk UI                      │ │
│  │                  │ updates │  • Task Queue (convoy/beads)  │ │
│  │ Maps Gastown     │         │  • Agent Status (polecats)    │ │
│  │ state → Synk     │         │  • Git Activity (hooks)       │ │
│  │ UI state         │         │  • Review Queue (refinery)    │ │
│  └──────────────────┘         └──────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────┐         ┌──────────────────────────────┐ │
│  │ CLI Executor     │────────▶│ gt / bd CLIs                 │ │
│  │                  │  runs   │                              │ │
│  │ User actions  →  │         │  gt sling <bead> <rig> --naked│ │
│  │ Synk translates  │         │  gt convoy create ...        │ │
│  │ to gt/bd commands│         │  bd create --title ...       │ │
│  └──────────────────┘         └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 15.2 Concept Mapping: Gastown → Synk UI

| Gastown Concept | Gastown Term | Synk UI Element | Data Source |
|----------------|-------------|-----------------|-------------|
| Workspace | Town (`~/gt/`) | Global config in Settings | `~/gt/.gt/config.json` |
| Project | Rig | Project Selector (sidebar) | `gt rig list` |
| AI Coordinator | Mayor | Dedicated session pane (pane #1) | `gt mayor attach` in PTY |
| Worker agent | Polecat | Auto-spawned session pane in grid | `gt sling --naked` |
| Your workspace | Crew | User's session pane | `gt crew add` |
| Task group | Convoy | Task Queue panel (bottom drawer) | `.beads/` + `gt convoy list` |
| Individual task | Bead | Task card in Task Queue | `bd list`, `bd show <id>` |
| Persistent state | Hook | Invisible (Gastown internal) | Agents manage their own hooks |
| Worker monitor | Witness | Agent Status Overview (sidebar) | File watch on polecat dirs |
| Merge queue | Refinery | Review Queue (bottom drawer) | `gt refinery queue` |
| Agent messaging | Mail | Not directly exposed (Gastown internal) | Agents use `gt mail` internally |
| Reusable workflow | Formula | Could map to Synk templates (future) | `bd formula list` |

### 15.3 Naked Mode: Synk Replaces tmux

Gastown normally spawns polecat agents into tmux sessions. Synk uses the `--naked` flag (a supported Gastown feature) to skip tmux and capture the agent process directly in Synk's PTY.

**Spawn Flow:**
```
User clicks "Dispatch Task" in Synk UI
    │
    ▼
Synk runs: bd create --title "Build auth system" --prefix <rig>
    │         → returns bead ID (e.g., gt-abc12)
    ▼
Synk runs: gt convoy create "Auth Feature" gt-abc12
    │         → creates convoy, returns convoy ID
    ▼
Synk runs: gt sling gt-abc12 myproject --naked
    │         → Gastown creates polecat directory
    │         → Sets up git worktree
    │         → Attaches hook with bead
    │         → Spawns agent process (NO tmux)
    │         → Returns: agent command + working directory
    ▼
Synk captures spawned process in new PTY
    │         → Creates new grid pane
    │         → Attaches xterm.js renderer
    │         → Pane header shows: polecat name, bead ID, branch
    ▼
Agent reads hook → starts working (GUPP principle)
    │
    ▼
Synk file watcher detects bead status changes
    │         → Updates task card in Task Queue
    │         → Updates agent status dot in sidebar
    ▼
Agent finishes → bead marked complete
    │         → Synk moves task to "Review" status
    │         → Review Queue gets new entry
    ▼
Refinery processes merge → Synk shows result in Review Queue
```

### 15.4 First-Time Setup Wizard (Gastown Mode)

When a user selects Gastown orchestration mode for the first time, Synk runs a guided setup. Every `gt` command executes in a **visible terminal pane** so the user sees what's happening.

```
Step 1: Detect CLI
  → Check: which gt && gt --version
  → Check: which bd && bd --version
  → If missing: show install commands with copy buttons
    $ go install github.com/steveyegge/gastown/cmd/gt@latest
    $ go install github.com/steveyegge/beads/cmd/bd@latest

Step 2: Workspace
  → Check: does ~/gt/ exist?
  → If no: [Create Workspace] → runs gt install ~/gt --git (in visible pane)
  → If yes: proceed to Step 3

Step 3: Add Project as Rig
  → Auto-detect project name and repo URL from .git/config
  → User confirms rig name
  → [Add as Rig] → runs gt rig add <name> <repo-url> (in visible pane)

Step 4: Health Check
  → Runs gt doctor (in visible pane)
  → Shows results: ✅ or ❌ per check
  → If issues: offer [Auto-Fix] → runs gt doctor --fix
  → All green: 🟢 "Gastown is ready!" → [Launch Workspace]
```

Key principle: **every `gt` command runs in a visible terminal pane** — Synk guides but never hides what's happening. This teaches the user Gastown while setting it up.

### 15.5 Runtime: Synk ↔ Gastown Command Mapping

| Synk UI Action | gt/bd Command(s) | Notes |
|---------------|-------------------|-------|
| Create task | `bd create --title "..." --prefix <rig>` | Returns bead ID |
| Group tasks | `gt convoy create "name" <bead-ids>` | Creates convoy |
| Dispatch task | `gt sling <bead> <rig> --naked` | Spawns polecat into Synk PTY |
| Check status | File watch on `~/gt/` OR `gt convoy list` | Primary: file watch. Fallback: CLI |
| View all agents | `gt agents` OR file watch on polecat dirs | Shows in sidebar |
| Nudge stuck agent | `gt nudge <agent> "message"` | Sends message to agent |
| Peek at agent | `gt peek <agent>` | Health check |
| Start Mayor | `gt mayor attach` (in dedicated PTY pane) | Pane #1 in grid |
| View merge queue | `gt refinery queue` | Shows in Review Queue |
| Run health check | `gt doctor` | Shown in settings/diagnostics |
| Auto-repair | `gt doctor --fix` | User-triggered |
| Kill polecat | `gt polecat kill <name>` + close Synk pane | Cleanup both sides |
| View convoy details | `gt convoy show <id>` | Expanded task group view |
| View bead details | `bd show <id>` | Expanded task card |

### 15.6 State Reconciliation

Synk maintains its own UI state store (Zustand) that mirrors Gastown's file-based state. The reconciler keeps them in sync:

**Primary mechanism:** Rust `notify` crate watches `~/gt/` directory tree with inotify. On file change → parse structured data (JSON/TOML) → diff against current Synk state → emit Tauri event with delta → Zustand store updates → React re-renders.

**Polling fallback:** If file watching fails or misses events, background poll every 5 seconds:
- `gt convoy list` → reconcile task/convoy state
- `gt agents` → reconcile agent state  
- `bd list --status=in_progress` → reconcile active work

**Watched paths and their UI mappings:**

| File/Directory | Change Type | UI Update |
|---------------|-------------|-----------|
| `.beads/<rig>/*.json` | Bead created/modified | Task card added/updated in Task Queue |
| `<rig>/polecats/*/` | Directory created/removed | Session pane added/removed from grid |
| `<rig>/polecats/*/hooks/` | Hook file changed | Agent status updated in sidebar |
| `.gt/convoys/` | Convoy file changed | Convoy group updated in Task Queue |
| `<rig>/settings/` | Config changed | Rig settings refreshed |

### 15.7 Error Handling & Edge Cases

| Scenario | Synk Behavior |
|----------|--------------|
| `gt` CLI not installed | Gastown mode disabled in UI. Show install instructions. |
| `gt` installed but no workspace | Trigger setup wizard on mode selection. |
| Polecat crashes mid-task | File watcher detects hook state → pane status → "error" → notification with re-sling option. |
| Gastown workspace corrupted | `gt doctor` in diagnostics → offer `gt doctor --fix`. |
| Bead ledger conflict | `bd sync` to reconcile → surface error in task queue if unresolvable. |
| User switches Gastown → Manual mode | Polecats keep running (just PTY processes). Task queue switches to local-only. |
| Gastown updates to new version | Version check on startup. Warn if `gt --version` doesn't match pinned v0.3.x. CLI fallback still works. |
| Agent finishes while Synk wasn't watching | Next poll cycle catches state change (5s max delay). |
| 12 sessions full, new task dispatched | Queue task, show notification "All sessions busy — task queued". |

---


## 16. Orchestrator Adapter Interface (Rust Trait)

The orchestrator adapter is the single abstraction that all orchestration modes implement. This trait is the foundation for the plugin system and must be stable from day one.

### 16.1 Core Trait Definition

```rust
use async_trait::async_trait;
use tokio::sync::mpsc;

/// Unique identifier for a task within the orchestrator
pub type TaskId = String;
/// Unique identifier for an agent/session within the orchestrator
pub type AgentId = String;

/// The core trait all orchestrators must implement.
/// Gastown, Agent Teams, Manual, and any future plugins implement this.
#[async_trait]
pub trait OrchestratorAdapter: Send + Sync {

    // ── Lifecycle ──────────────────────────────────────────────

    /// Human-readable name for the UI mode selector.
    fn name(&self) -> &str;

    /// Check if this orchestrator is available on the system.
    /// e.g., Gastown checks `which gt`, Agent Teams checks Claude version.
    async fn is_available(&self) -> AdapterStatus;

    /// Initialize the adapter. Called once when user selects this mode.
    /// Returns a receiver for events the adapter emits.
    async fn initialize(&mut self, config: AdapterConfig)
        -> Result<mpsc::UnboundedReceiver<OrchestratorEvent>, AdapterError>;

    /// Graceful shutdown. Clean up watchers, close connections.
    async fn shutdown(&mut self) -> Result<(), AdapterError>;

    // ── Task Management ────────────────────────────────────────

    /// Create a new task. Returns the orchestrator's native task ID.
    async fn create_task(&self, task: TaskDefinition)
        -> Result<TaskId, AdapterError>;

    /// Dispatch a task to an available agent. Returns spawn info
    /// so Synk can capture the process in a PTY pane.
    async fn dispatch_task(&self, task_id: &TaskId, session_hint: Option<usize>)
        -> Result<SpawnRequest, AdapterError>;

    /// Cancel a running task. Agent process should be terminated.
    async fn cancel_task(&self, task_id: &TaskId)
        -> Result<(), AdapterError>;

    /// Get current status of all tasks.
    async fn list_tasks(&self) -> Result<Vec<TaskStatus>, AdapterError>;

    // ── Agent Management ───────────────────────────────────────

    /// Get status of all active agents/workers.
    async fn list_agents(&self) -> Result<Vec<AgentStatus>, AdapterError>;

    /// Send a message/nudge to a specific agent.
    async fn message_agent(&self, agent_id: &AgentId, message: &str)
        -> Result<(), AdapterError>;

    /// Health check on a specific agent.
    async fn check_agent(&self, agent_id: &AgentId)
        -> Result<AgentHealth, AdapterError>;

    /// Kill a specific agent.
    async fn kill_agent(&self, agent_id: &AgentId)
        -> Result<(), AdapterError>;

    // ── Review / Completion ────────────────────────────────────

    /// Get list of completed work ready for review.
    async fn review_queue(&self) -> Result<Vec<ReviewItem>, AdapterError>;

    /// Mark a reviewed item as approved (trigger merge).
    async fn approve_review(&self, task_id: &TaskId, strategy: MergeStrategy)
        -> Result<(), AdapterError>;

    /// Reject a reviewed item (return to queue with feedback).
    async fn reject_review(&self, task_id: &TaskId, feedback: &str)
        -> Result<(), AdapterError>;

    // ── Optional Capabilities ──────────────────────────────────

    /// What optional features does this adapter support?
    /// UI hides/shows controls based on this.
    fn capabilities(&self) -> AdapterCapabilities;
}
```

### 16.2 Supporting Types

```rust
/// Result of checking if an orchestrator is usable
pub enum AdapterStatus {
    /// Ready to use
    Available { version: String },
    /// Installed but needs setup (e.g., no Gastown workspace)
    NeedsSetup { reason: String },
    /// Not installed on this system
    NotInstalled { install_hint: String },
}

/// Configuration passed during initialization
pub struct AdapterConfig {
    pub project_path: PathBuf,        // e.g., /home/jaden/projects/grid-betting
    pub project_name: String,         // e.g., "grid-betting"
    pub max_agents: usize,            // 1-12 based on grid capacity
    pub default_agent_type: AgentType, // Claude Code, Gemini CLI, etc.
}

/// What Synk needs to spawn a PTY pane for an agent
pub struct SpawnRequest {
    pub command: String,              // e.g., "claude" or the full agent command
    pub args: Vec<String>,            // e.g., ["--model", "opus"]
    pub working_dir: PathBuf,         // e.g., worktree path
    pub env: HashMap<String, String>, // extra env vars
    pub agent_id: AgentId,            // orchestrator's ID for this agent
    pub task_id: TaskId,              // which task this agent is working on
    pub label: String,                // display name for pane header
}

/// Events emitted by the adapter to update Synk's UI
pub enum OrchestratorEvent {
    /// A task changed status (created, started, completed, failed)
    TaskUpdated(TaskStatus),
    /// An agent changed state (spawned, working, idle, crashed)
    AgentUpdated(AgentStatus),
    /// Work is ready for review
    ReviewReady(ReviewItem),
    /// Merge completed
    MergeCompleted { task_id: TaskId, branch: String, success: bool },
    /// Orchestrator-level error
    Error(AdapterError),
    /// Orchestrator wants to display a notification
    Notification { level: NotifyLevel, message: String },
}

pub struct TaskDefinition {
    pub title: String,
    pub description: String,
    pub priority: Priority,           // High, Medium, Low
    pub dependencies: Vec<TaskId>,    // tasks that must complete first
    pub agent_type: Option<AgentType>, // override default if needed
    pub branch_name: Option<String>,  // suggested branch name
}

pub struct TaskStatus {
    pub id: TaskId,
    pub title: String,
    pub state: TaskState,             // Queued, Dispatched, InProgress, Review, Done, Failed
    pub agent_id: Option<AgentId>,    // which agent is working on it
    pub branch: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub enum TaskState {
    Queued,
    Dispatched,
    InProgress,
    Review,
    Done,
    Failed { reason: String },
    Blocked { waiting_on: Vec<TaskId> },
}

pub struct AgentStatus {
    pub id: AgentId,
    pub label: String,                // display name
    pub state: AgentState,            // Idle, Working, Waiting, Error
    pub current_task: Option<TaskId>,
    pub branch: Option<String>,
    pub cost_so_far: Option<f64>,     // dollars
}

pub enum AgentState {
    Idle,
    Working,
    Waiting,    // waiting for user input or dependency
    Error(String),
    Finished,
}

/// Feature flags — UI hides controls for unsupported features
pub struct AdapterCapabilities {
    pub supports_task_groups: bool,     // convoys (Gastown: yes, Manual: no)
    pub supports_agent_messaging: bool, // nudge (Gastown: yes, Manual: no)
    pub supports_review_queue: bool,    // refinery (Gastown: yes, Manual: no)
    pub supports_auto_dispatch: bool,   // (Gastown: yes, Agent Teams: no)
    pub supports_agent_health: bool,    // peek (Gastown: yes, Manual: no)
    pub max_concurrent_agents: usize,   // Gastown: 12, Agent Teams: 1 primary
    pub requires_setup: bool,           // Gastown: yes, Manual: no
}
```

### 16.3 How Each Mode Implements the Trait

| Method | Gastown | Agent Teams | Manual |
|--------|---------|-------------|--------|
| `is_available()` | Checks `which gt && gt --version` | Checks `claude --version` for agent teams support | Always available |
| `initialize()` | Starts file watcher on `~/gt/`, verifies rig | Starts output parser on primary session | No-op, returns empty event channel |
| `create_task()` | `bd create --title "..." --prefix <rig>` → returns bead ID | Sends prompt to primary Claude with task instruction | Creates local task in Zustand store |
| `dispatch_task()` | `gt sling <bead> <rig> --naked` → returns SpawnRequest | Claude internally spawns subagent (no SpawnRequest, Synk monitors) | Returns SpawnRequest for user-selected agent type |
| `list_tasks()` | Reads bead files from `~/gt/.beads/` | Parses primary session output for subagent tasks | Returns local task list |
| `list_agents()` | Reads polecat directories under `~/gt/<rig>/polecats/` | Parses Claude output for active subagents | Returns list of open PTY sessions |
| `message_agent()` | `gt nudge <agent> "message"` | Types message into primary Claude session | Types directly into target pane PTY |
| `review_queue()` | `gt refinery queue` parsed output | Not applicable (single-session review) | Returns manually-flagged branches for review |
| `shutdown()` | Stops file watcher, optionally kills polecats | No-op (Claude session keeps running) | No-op |

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


