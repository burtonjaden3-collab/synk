# TASK 6C.1: Plugin Loader (Backend)
> Phase 6 — Polish | Session C | Depends on: Phase 5

## What to Build
Dynamic plugin system: load .so files at runtime that implement the OrchestratorAdapter trait. Plugin manifest (plugin.toml), SDK crate for plugin authors, install/uninstall flow.

## Plugin Structure
```
~/.config/synk/plugins/{name}/
├── plugin.toml              # manifest
└── lib{name}.so             # compiled plugin
```

## plugin.toml
```toml
[plugin]
name = "my-orchestrator"
version = "0.1.0"
description = "Custom orchestrator"
author = "Developer Name"
min_synk_version = "1.0.0"

[capabilities]
can_spawn = true
can_assign_tasks = true
can_review = false
```

## C ABI Functions (exported by plugin)
```rust
extern "C" fn synk_create_adapter() -> *mut dyn OrchestratorAdapter
extern "C" fn synk_destroy_adapter(ptr: *mut dyn OrchestratorAdapter)
```

## Deliverables
1. Plugin loader in `orchestrator/mod.rs` — discover, validate, load plugins via `libloading`
2. `synk-plugin-sdk/` — new Rust crate: re-exports trait + types, example plugin template
3. Plugin install: unzip .synk-plugin file → copy to plugins directory → load
4. Plugins appear in orchestrator mode selector alongside built-in modes
5. Plugin settings page in Settings → Plugins (list, enable/disable, uninstall)

## Files to Create/Modify
```
src-tauri/src/orchestrator/mod.rs  (add plugin loading)
synk-plugin-sdk/Cargo.toml        (new crate)
synk-plugin-sdk/src/lib.rs        (trait re-export + helpers)
```

## Acceptance Test
Create example plugin implementing adapter trait. Compile to .so. Place in plugins directory. Launch Synk → plugin appears in mode selector. Select it → adapter methods called correctly.

---
## SPEC REFERENCE (Read all of this carefully)
## 24. Plugin API — Loading & Interface

### 24.1 Plugin Architecture

Synk uses **dynamic shared libraries** (.so on Linux) for orchestrator plugins. Each plugin is a compiled Rust crate that implements `OrchestratorAdapter`.

```
~/.config/synk/plugins/
├── my-custom-orchestrator/
│   ├── plugin.toml           # metadata
│   └── libmy_orchestrator.so # compiled plugin
└── cursor-adapter/
    ├── plugin.toml
    └── libcursor_adapter.so
```

### 24.2 Plugin Manifest (`plugin.toml`)

```toml
[plugin]
name = "my-custom-orchestrator"
version = "0.1.0"
description = "Custom orchestration for my team's workflow"
author = "Jaden"
synk_api_version = "1.0"             # minimum Synk plugin API version
entry = "libmy_orchestrator.so"       # shared library filename

[capabilities]
supports_task_groups = true
supports_agent_messaging = false
supports_review_queue = true
supports_auto_dispatch = true
supports_agent_health = false
max_concurrent_agents = 8
requires_setup = true

[settings]                            # plugin-specific settings exposed in UI
[settings.api_url]
type = "string"
label = "API URL"
default = "http://localhost:9000"

[settings.auth_token]
type = "secret"
label = "Auth Token"
default = ""
```

### 24.3 Plugin Loading

```rust
/// Synk exports this C ABI function signature that plugins must implement:
#[no_mangle]
pub extern "C" fn synk_create_adapter() -> *mut dyn OrchestratorAdapter;

/// And a destroy function for cleanup:
#[no_mangle]
pub extern "C" fn synk_destroy_adapter(adapter: *mut dyn OrchestratorAdapter);

/// Plugin loader in Synk:
pub struct PluginLoader {
    loaded: HashMap<String, LoadedPlugin>,
}

pub struct LoadedPlugin {
    lib: libloading::Library,
    manifest: PluginManifest,
    adapter: Box<dyn OrchestratorAdapter>,
}

impl PluginLoader {
    pub fn discover(&mut self) -> Vec<PluginManifest> {
        // 1. Scan ~/.config/synk/plugins/
        // 2. Read each plugin.toml
        // 3. Validate synk_api_version compatibility
        // 4. Return list of available plugins
    }

    pub fn load(&mut self, name: &str) -> Result<&dyn OrchestratorAdapter, PluginError> {
        // 1. dlopen the .so file
        // 2. dlsym("synk_create_adapter")
        // 3. Call the function to get a trait object
        // 4. Store in loaded map
        // 5. Return reference
    }

    pub fn unload(&mut self, name: &str) -> Result<(), PluginError> {
        // 1. Call synk_destroy_adapter
        // 2. dlclose the library
        // 3. Remove from loaded map
    }
}
```

### 24.4 Plugin Development Workflow

Synk ships a `synk-plugin-sdk` crate that plugin authors depend on:

```toml
# Plugin author's Cargo.toml
[dependencies]
synk-plugin-sdk = "1.0"   # provides OrchestratorAdapter trait + types
async-trait = "0.1"
tokio = { version = "1", features = ["full"] }
```

```rust
// Plugin author's lib.rs
use synk_plugin_sdk::prelude::*;

pub struct MyOrchestrator { /* ... */ }

#[async_trait]
impl OrchestratorAdapter for MyOrchestrator {
    fn name(&self) -> &str { "My Custom Orchestrator" }
    // ... implement all required methods
}

#[no_mangle]
pub extern "C" fn synk_create_adapter() -> *mut dyn OrchestratorAdapter {
    Box::into_raw(Box::new(MyOrchestrator::new()))
}

#[no_mangle]
pub extern "C" fn synk_destroy_adapter(adapter: *mut dyn OrchestratorAdapter) {
    unsafe { drop(Box::from_raw(adapter)); }
}
```

### 24.5 UI Integration

Plugins appear in the orchestrator mode selector alongside built-in modes:

```
Mode Selector:
  ● Gastown          (built-in)
  ○ Claude Agent Teams (built-in)
  ○ Manual           (built-in)
  ──────────────────
  ○ My Orchestrator  (plugin)    [⚙ Settings] [🗑 Remove]
  ──────────────────
  [+ Install Plugin]
```

"Install Plugin" opens a file picker for a `.synk-plugin` zip file (which contains the .so + plugin.toml). Synk extracts it to `~/.config/synk/plugins/`.

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


