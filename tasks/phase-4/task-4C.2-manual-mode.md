# TASK 4C.2: Manual Mode Adapter (Backend)
> Phase 4 — Orchestration | Session C (Adapters) | Depends on: Phase 3

## What to Build
Simple adapter for manual orchestration. No automated dispatch. User manages everything through the command bar and task queue UI. Local task list stored in .synk/tasks.json.

## What Manual Mode Does
- Tasks stored locally in .synk/tasks.json (no Gastown, no external orchestrator)
- User creates tasks in the Task Queue panel
- User manually assigns tasks to sessions via command bar: `/dispatch @3`
- Task status tracked: queued → in_progress → review → done
- No auto-dispatch, no dependency resolution, no convoy grouping

## Deliverables
1. `orchestrator/manual.rs` — ManualAdapter implementing OrchestratorAdapter trait
2. CRUD operations: create_task, update_task, delete_task, list_tasks
3. Dispatch: user assigns task to session manually → adapter records assignment
4. Status updates: adapter tracks task through its lifecycle
5. Persistence: read/write .synk/tasks.json

## Files to Create/Modify
```
src-tauri/src/orchestrator/manual.rs (new)
```

## Acceptance Test
Switch to Manual mode. Create task → appears in .synk/tasks.json. Assign to session → status changes to in_progress. No auto-dispatch happens.

---
## SPEC REFERENCE (Read all of this carefully)
## 7. Orchestration Modes

### 7.1 Gastown Mode (Default)
- Requires Gastown CLI (`gt`) installed
- App spawns sessions as Gastown rigs/polecats
- Task queue maps to Gastown convoys and beads
- The Mayor agent runs as a dedicated session
- Status updates flow through Gastown's hook system
- Supports scaling to 12 parallel agents via the grid

### 7.2 Claude Agent Teams Mode
- Uses Claude Code's native Agent Teams (Opus 4.6+)
- Single primary Claude Code session in one pane
- Subagents spawned internally by Claude appear as monitored processes
- App monitors Agent Teams via MCP or output parsing
- Best for medium-complexity tasks within a single session
- Other grid panes can still run independent sessions alongside

### 7.3 Manual Mode
- No orchestrator — pure multi-terminal
- User manages all sessions manually
- Direct typing into each pane
- Central command bar for dispatching prompts to specific sessions
- Broadcast mode to send same prompt to all sessions
- Task queue available as a local checklist (no auto-dispatch)

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


