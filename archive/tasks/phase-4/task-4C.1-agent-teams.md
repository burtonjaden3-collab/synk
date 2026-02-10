# TASK 4C.1: Agent Teams Adapter (Backend)
> Phase 4 — Orchestration | Session C (Adapters) | Depends on: Phase 3

## What to Build
Adapter for Claude Code's internal sub-agent system (Agent Teams). Since Claude Code controls its own agents, Synk only MONITORS — it parses PTY output to detect when Claude spawns/completes sub-agents.

## Detection Patterns (regex on PTY stdout)
```regex
Agent spawned:  /╭─.*Agent\s+(\w+)/
Agent working:  /├─.*Working on:\s+(.+)/
Agent complete: /╰─.*Agent\s+(\w+).*completed/
Task output:    /✓\s+(.+)/
```

## What Synk CAN vs CANNOT Do
| Action | Can? | How |
|--------|------|-----|
| See how many sub-agents exist | ✅ | Parse PTY output |
| See what each is working on | ✅ | Parse "Working on:" lines |
| See when they finish | ✅ | Parse completion lines |
| Control which sub-agents spawn | ❌ | Claude decides |
| Assign tasks to specific sub-agents | ❌ | Claude decides |
| Stop a specific sub-agent | ❌ | Can only Ctrl+C the whole session |

## Deliverables
1. `orchestrator/agent_teams.rs` — AgentTeamsAdapter implementing OrchestratorAdapter trait
2. PTY output parser with regex patterns above
3. Graceful degradation: if patterns don't match (Claude changes output format), log warning and show "unknown" status instead of crashing
4. AgentTeamsState struct tracking detected sub-agents

## Files to Create/Modify
```
src-tauri/src/orchestrator/agent_teams.rs (new)
```

## Acceptance Test
Launch Claude Code session with agent teams mode. Claude spawns sub-agents → Synk detects them in sidebar. Sub-agent completes → status updates. If output format changes → shows "unknown" gracefully.

---
## SPEC REFERENCE (Read all of this carefully)
## 17. Claude Agent Teams Adapter — Technical Deep Dive

### 17.1 How Agent Teams Works

Claude Code's Agent Teams (Opus 4.6+) is a **single-session** orchestration model:
- User gives a complex task to one Claude Code session
- Claude autonomously decides to spawn **subagents** — separate Claude instances that handle subtasks
- Subagents report back to the primary agent (the "lead")
- The primary agent coordinates, merges results, and presents the final output

**Key constraint:** Synk doesn't control subagent spawning. Claude decides when and how many.

### 17.2 Integration Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ SYNK GRID                                                       │
│                                                                 │
│ ┌──────────────────────┐  ┌──────────────────┐                 │
│ │ PANE 1 (Primary)     │  │ PANE 2 (Free)    │                 │
│ │ ▶ Claude Code        │  │ ▶ Gemini CLI     │                 │
│ │                      │  │   (independent)   │                 │
│ │ "Build auth system"  │  │                   │                 │
│ │                      │  │                   │                 │
│ │ → spawns 3 subagents │  │                   │                 │
│ └──────────┬───────────┘  └──────────────────┘                 │
│            │                                                    │
│ ┌──────────▼───────────────────────────────────────────────┐   │
│ │ AGENT TEAMS MONITOR (in sidebar, not a pane)              │   │
│ │                                                           │   │
│ │  Lead Agent     ● Working   "Building auth system"        │   │
│ │  ├─ Subagent 1  ● Working   "Setting up database schema" │   │
│ │  ├─ Subagent 2  ● Working   "Creating API routes"        │   │
│ │  └─ Subagent 3  ● Idle      "Writing tests" (queued)     │   │
│ └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 17.3 Detection: How Synk Knows Subagents Exist

Synk monitors the primary Claude Code session's PTY output stream for subagent markers. Claude Code emits structured output when spawning subagents:

**Output patterns to detect (regex):**

```
// Subagent spawn detection
/⏳ Spawning agent: (.+)/                    → agent name/description
/🤖 Agent "(.+)" started on: (.+)/          → agent name, task description
/Agent \[(\d+)\] working on: (.+)/           → agent index, task

// Subagent completion detection
/✅ Agent "(.+)" completed/                  → agent finished successfully
/❌ Agent "(.+)" failed: (.+)/               → agent failed with reason
/🤖 Agent \[(\d+)\] result: (.+)/            → agent result summary

// Subagent status (periodic)
/Agents: (\d+) active, (\d+) queued, (\d+) done/  → aggregate status
```

**Important:** These patterns are based on Claude Code's current output format and WILL change. The adapter must:
1. Log unrecognized output to help update patterns
2. Degrade gracefully — if parsing fails, show "Agent Teams active, details unavailable"
3. Version-check Claude Code on startup and warn if output format may have changed

### 17.4 What Synk Can and Cannot Do in Agent Teams Mode

| Action | Supported? | How |
|--------|-----------|-----|
| View subagent count & status | ✅ | Parse PTY output |
| See what each subagent is working on | ✅ (partial) | Parse task descriptions from output |
| Kill a specific subagent | ❌ | Claude controls subagent lifecycle |
| Send message to a subagent | ❌ | No direct access; must message primary agent |
| Create new tasks | ✅ | Send prompt to primary Claude session |
| Set subagent count | ❌ | Claude decides based on task complexity |
| Review subagent work | ✅ (indirect) | Review the primary agent's final output/branch |
| Track cost per subagent | ❌ | Claude reports aggregate cost only |
| Run alongside independent panes | ✅ | Other grid panes can run any agent type |

### 17.5 Adapter Capabilities

```rust
AdapterCapabilities {
    supports_task_groups: false,      // no convoys, Claude manages internally
    supports_agent_messaging: false,  // can only message primary agent
    supports_review_queue: false,     // review happens on primary agent's branch
    supports_auto_dispatch: false,    // Claude dispatches its own subagents
    supports_agent_health: false,     // no peek equivalent
    max_concurrent_agents: 1,         // 1 primary (internally may have many subagents)
    requires_setup: false,            // just needs claude CLI installed
}
```

### 17.6 State Management

The Agent Teams adapter maintains an `AgentTeamsState` struct:

```rust
pub struct AgentTeamsState {
    pub primary_session_id: usize,            // which Synk grid pane has the lead
    pub lead_task: Option<String>,            // what the primary agent is working on
    pub subagents: Vec<SubagentInfo>,         // parsed from output
    pub aggregate_cost: Option<f64>,          // from Claude's cost output
    pub last_output_parse: DateTime<Utc>,     // freshness
}

pub struct SubagentInfo {
    pub index: usize,                         // sequential ID from output
    pub name: String,                         // parsed name/description
    pub task: String,                         // what it's working on
    pub state: AgentState,                    // Working, Done, Failed
    pub detected_at: DateTime<Utc>,
}
```

The adapter subscribes to the primary pane's PTY output stream (via a Tauri event) and runs regex matching on each new chunk. It emits `OrchestratorEvent::AgentUpdated` events when subagent state changes, which the sidebar's Agent Teams Monitor component consumes.

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


