# TASK 2.5: Settings Panel
> Phase 2 — Sidebar & Config | Single Session | Depends on: Task 2.1
>
> Status: ✅ Completed (2026-02-08)

## What to Build
Full settings UI with tabbed layout. Manages all global settings including AI provider setup with dual auth (API key OR OAuth sign-in).

## Settings Tabs
| Tab | Contents |
|-----|----------|
| AI Providers | Auth mode toggle (API key / OAuth), key inputs, sign-in buttons, default model per provider |
| Performance | Pool size slider, max sessions, recycle toggle |
| Keyboard | Escape method selector (double-escape / Ctrl+\ / Ctrl+Shift+Escape) |
| Appearance | Sidebar width, drawer height, dim unfocused toggle, opacity slider |
| Notifications | Per-type toggles, toast position, duration |
| Git | Default merge strategy, auto-delegate conflicts toggle, worktree base path |
| Sessions | Auto-save toggle, auto-save interval |
| Integrations | Gastown CLI path, workspace path |
| About | Version info |

## Deliverables
1. `Settings.tsx` — tabbed settings panel (opens with Ctrl+,)
2. `settings.rs` — Tauri commands to read/write ~/.config/synk/settings.json
3. All settings read from and persist to settings.json
4. AI Provider section: each provider shows API key input OR OAuth sign-in button
5. Validation: test API key connectivity, show ✅/❌

## Files to Create/Modify
```
src/components/shared/Settings.tsx     (new)
src-tauri/src/commands/settings.rs     (new)
src/lib/store.ts                       (settings state)
src/lib/keybindings.ts                 (Ctrl+, handler)
```

## Acceptance Test
Ctrl+, opens settings. Paste an API key → shows ✅ Valid. Change pool size → saves to settings.json. Close and reopen → settings persist.

---
## SPEC REFERENCE (Read all of this carefully)
## 33. Settings Schema

### 33.1 Global Settings (`~/.config/synk/settings.json`)

```json
{
  "version": 1,
  
  "ai_providers": {
    "default": "anthropic",
    "anthropic": {
      "auth_mode": "oauth",
      "api_key": null,
      "oauth_connected": true,
      "oauth_email": "jaden@example.com",
      "default_model": "claude-sonnet-4-5-20250929"
    },
    "google": {
      "auth_mode": "api_key",
      "api_key": "AIza...",
      "oauth_connected": false,
      "oauth_email": null,
      "default_model": "gemini-2.0-flash"
    },
    "openai": {
      "auth_mode": null,
      "api_key": null,
      "oauth_connected": false,
      "oauth_email": null,
      "default_model": "gpt-4o"
    },
    "ollama": {
      "base_url": "http://localhost:11434",
      "default_model": "llama3.1"
    }
  },
  
  "performance": {
    "initial_pool_size": 2,
    "max_pool_size": 4,
    "max_active_sessions": 12,
    "recycle_enabled": true,
    "max_pty_age_minutes": 30,
    "warmup_delay_ms": 100,
    "poll_interval_ms": 5000
  },
  
  "keyboard": {
    "terminal_exit_method": "double_escape",
    "double_escape_timeout_ms": 300,
    "custom_bindings": {}
  },
  
  "ui": {
    "sidebar_width": 280,
    "drawer_height": 250,
    "drawer_panel_order": ["cost", "git", "tasks", "reviews"],
    "show_session_cost_in_header": true,
    "dim_unfocused_panes": true,
    "unfocused_opacity": 0.7
  },
  
  "notifications": {
    "task_completed": true,
    "agent_error": true,
    "merge_conflict": true,
    "review_ready": true,
    "cost_threshold": null,
    "position": "top-right",
    "duration_ms": 5000
  },
  
  "git": {
    "default_merge_strategy": "squash",
    "auto_delegate_conflicts": true,
    "worktree_base_path": "~/.synk/worktrees",
    "branch_prefix": "feat/"
  },
  
  "session": {
    "auto_save": true,
    "auto_save_interval_seconds": 60
  },
  
  "gastown": {
    "cli_path": null,
    "workspace_path": "~/gt/",
    "pinned_version": "0.3.x"
  }
}
```

### 33.2 Settings UI Sections

The Settings panel (`Ctrl+,`) is organized into tabs:

| Tab | Contains |
|-----|----------|
| **AI Providers** | Auth mode toggle (API key / Sign In), API keys, OAuth connect buttons, default models, provider health check |
| **Performance** | Pool size slider, max sessions, recycle toggle, RAM estimate |
| **Keyboard** | Escape method selector, custom binding editor |
| **Appearance** | Sidebar width, drawer height, panel order, opacity |
| **Notifications** | Toggle per notification type, position, duration |
| **Git** | Default merge strategy, conflict delegation toggle, worktree path, branch prefix |
| **Sessions** | Auto-save toggle, auto-save interval |
| **Integrations** | Gastown setup, CLI path, workspace path |
| **Plugins** | Installed plugins list, install/remove, per-plugin settings |
| **About** | Version, credits, links |

---


## 18. AI Provider Router — Detailed Architecture

### 18.1 Provider Trait

```rust
use async_trait::async_trait;
use tokio::sync::mpsc;

#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Provider name for UI display
    fn name(&self) -> &str;

    /// Validate that the API key works
    async fn validate_key(&self, key: &str) -> Result<bool, ProviderError>;

    /// Send a message and get a streaming response.
    /// Returns a receiver that yields chunks as they arrive.
    async fn chat_stream(
        &self,
        messages: &[ChatMessage],
        system_prompt: &str,
        options: ChatOptions,
    ) -> Result<mpsc::UnboundedReceiver<StreamChunk>, ProviderError>;

    /// Send a message and get a complete response (non-streaming).
    /// Used for structured data extraction where we need the full response.
    async fn chat_complete(
        &self,
        messages: &[ChatMessage],
        system_prompt: &str,
        options: ChatOptions,
    ) -> Result<String, ProviderError>;
}

pub struct ChatMessage {
    pub role: Role,          // User, Assistant, System
    pub content: String,
}

pub struct ChatOptions {
    pub model: Option<String>,       // override default model
    pub temperature: Option<f32>,    // 0.0-1.0
    pub max_tokens: Option<usize>,
    pub json_mode: bool,             // request JSON output (for structured extraction)
}

pub enum StreamChunk {
    Text(String),              // content token
    Done { usage: TokenUsage }, // stream complete
    Error(String),             // stream error
}

pub struct TokenUsage {
    pub input_tokens: usize,
    pub output_tokens: usize,
}
```

### 18.2 Provider Implementations

| Provider | Crate / Method | Endpoint | Default Model | Auth Options |
|----------|---------------|----------|---------------|-------------|
| Anthropic | `reqwest` → Messages API | `https://api.anthropic.com/v1/messages` | `claude-sonnet-4-5-20250929` | API key (`x-api-key` header) OR OAuth token (subscription) |
| Google | `reqwest` → Gemini API | `https://generativelanguage.googleapis.com/v1beta/` | `gemini-2.0-flash` | API key (`?key=` param) OR Google OAuth (subscription) |
| OpenAI | `reqwest` → Chat Completions | `https://api.openai.com/v1/chat/completions` | `gpt-4o` | API key (`Authorization: Bearer`) OR OAuth token (subscription) |
| Ollama | `reqwest` → Local REST | `http://localhost:11434/api/chat` | User-selected | None (local) |

All use raw `reqwest` with SSE parsing for streaming. No SDK dependencies — keeps the binary small and avoids version lock-in.

### 18.2.1 Dual Auth Strategy

Each provider (except Ollama) supports two auth modes:

**API Key mode:**
- User pastes key in Settings
- Direct per-token billing to user's API account
- Higher rate limits, full model access
- Key stored in `~/.config/synk/settings.json` (plaintext — same as Claude Code and other CLI tools)

**Subscription Auth mode (OAuth):**
- User clicks "Sign In" → Synk opens browser to provider's OAuth consent screen
- User authorizes Synk → receives OAuth token
- Uses the user's existing subscription (Claude Pro, Gemini Advanced, ChatGPT Plus)
- Token stored in system keyring via `keyring` crate (Linux: libsecret/GNOME Keyring)
- Token refresh handled automatically; re-auth prompt if refresh fails

**Auth selection logic:**
```rust
async fn get_auth(&self) -> AuthHeader {
    // Prefer OAuth token if available and valid
    if let Some(token) = self.oauth_token() {
        if !token.is_expired() {
            return AuthHeader::Bearer(token.access_token);
        }
        // Try refresh
        if let Ok(refreshed) = self.refresh_token(&token).await {
            return AuthHeader::Bearer(refreshed.access_token);
        }
    }
    // Fall back to API key
    if let Some(key) = self.api_key() {
        return AuthHeader::ApiKey(key);
    }
    AuthHeader::None // will cause a ProviderError on next request
}
```

**Rate limit awareness:** Subscription-based access typically has lower rate limits than API keys. Synk shows a warning in the brainstorm wizard if the user is on subscription auth and sends many rapid requests: "You're using subscription auth — responses may be rate-limited. Switch to API key for higher throughput."

### 18.3 Conversation State Management

The brainstorm wizard manages a conversation as a **growing message array** stored in the React component's local state (not Zustand — it doesn't need to persist across views):

```typescript
interface BrainstormState {
  provider: 'anthropic' | 'google' | 'openai' | 'ollama';
  messages: ChatMessage[];           // full conversation history
  extractedData: ProjectBlueprint;   // structured data extracted so far
  currentPhase: 'brainstorm' | 'blueprint' | 'refine' | 'export';
  isStreaming: boolean;
  streamBuffer: string;              // current response being streamed
}

interface ProjectBlueprint {
  name: string | null;
  description: string | null;
  techStack: string[];
  features: Feature[];
  entities: Entity[];
  diagrams: {
    architecture: string | null;     // mermaid source
    fileStructure: string | null;
    database: string | null;
    apiRoutes: string | null;
    deployment: string | null;
  };
}
```

### 18.4 Conversation Flow: Brainstorm → Blueprint

**Phase 1: Brainstorm Chat**

Every message to the AI includes a system prompt that instructs it to:
1. Ask clarifying questions about the project
2. Extract structured data and embed it in a `<structured>` XML tag at the end of each response
3. Signal when it has enough information to generate blueprints

```
SYSTEM PROMPT (brainstorm phase):
You are a senior software architect helping plan a new project.
Your job is to understand what the user wants to build through conversation.

Ask focused questions about: tech stack preferences, target users,
core features, data models, scale expectations, deployment target.

After each response, include a <structured> block with any new
information you've extracted. Use this exact JSON schema:
<structured>
{
  "name": "project-name-or-null",
  "description": "one-line-description-or-null",
  "tech_stack": ["react", "node"],
  "features": [{"name": "Auth", "description": "User login/signup"}],
  "entities": [{"name": "User", "fields": ["id", "email", "name"]}],
  "ready_for_blueprint": false
}
</structured>

Set ready_for_blueprint to true ONLY when you have enough information
to generate all 5 diagram types. This typically requires understanding:
- Core features (at least 3)
- Data entities (at least 2)
- Tech stack decisions
- Deployment target
```

Synk's frontend parses the `<structured>` block from each response, merges it with the running `ProjectBlueprint` state, and shows a live "extraction progress" indicator in the sidebar:
- ✅ Project name
- ✅ Tech stack (3 items)
- ⬜ Data models (need more detail)
- ✅ Core features (4 identified)
- ⬜ Deployment target

When `ready_for_blueprint` becomes true, the UI shows a "Generate Blueprint →" button.

**Phase 2: Blueprint Generation**

User clicks "Generate Blueprint." Synk sends 5 sequential (not parallel) requests to the AI, one per diagram type. Each uses a specialized system prompt:

```
SYSTEM PROMPT (architecture diagram):
Given the following project specification, generate a Mermaid flowchart
diagram showing the system architecture. Include all major components,
services, databases, external APIs, and data flow between them.

Use `flowchart TD` syntax. Use descriptive node labels. Group related
components with subgraph blocks.

Respond with ONLY valid Mermaid syntax. No markdown fences, no explanation.

PROJECT SPEC:
{serialized ProjectBlueprint as JSON}
```

Similar specialized prompts exist for each of the 5 diagram types (see Section D for exact templates).

**Phase 3: Refinement**

User edits diagrams manually OR chats with AI to request changes. When chatting:
- The current Mermaid source is included in the message as context
- AI returns updated Mermaid source
- Synk live-renders the diff in the preview panel

```
SYSTEM PROMPT (refinement):
The user has a project blueprint with diagrams. They want to modify
a specific diagram. The current Mermaid source is provided below.

Return the COMPLETE updated Mermaid source (not a diff). Respond with
ONLY valid Mermaid syntax.

CURRENT DIAGRAM ({diagram_type}):
{current mermaid source}
```

### 18.5 Streaming Implementation

The Rust backend handles SSE parsing. The frontend gets chunks via Tauri events:

```
Frontend calls: invoke('ai_chat_stream', { provider, messages, systemPrompt })
    │
    ▼
Rust backend:
    1. Opens HTTP connection with streaming enabled
    2. Parses SSE events (data: {"type": "content_block_delta", ...})
    3. Emits Tauri event 'ai:stream-chunk' for each text delta
    4. Emits Tauri event 'ai:stream-done' with token usage on completion
    5. Emits Tauri event 'ai:stream-error' on failure
    │
    ▼
Frontend:
    1. Listens for 'ai:stream-chunk' events
    2. Appends to streamBuffer
    3. Renders partial markdown in chat UI
    4. On 'ai:stream-done': parse <structured> block, update extractedData
```

---


## 34. Data Storage Architecture

### 34.1 Unified Storage Map

All Synk data lives in two locations: global config (`~/.config/synk/`) and project-level (`.synk/` inside each project).

```
~/.config/synk/                          # GLOBAL (user-level)
├── settings.json                        # Global settings (§34)
├── pricing.json                         # Model pricing table (§23)
├── projects.json                        # Known project list (§29)
├── sessions/                            # Saved session layouts
│   ├── {name}.json                      # Named saves
│   └── {project}-autosave.json          # Auto-saves
├── reviews/                             # Review data (§20)
│   └── {project}/
│       ├── {review-id}.json             # ReviewItem
│       └── comments/
│           └── {review-id}.json         # ReviewComment[]
├── stats/                               # Aggregate statistics
│   └── {project}.json                   # Total sessions, cost, tasks, time
├── plugins/                             # Orchestrator plugins (§24)
│   └── {plugin-name}/
│       ├── plugin.toml
│       └── lib{name}.so
└── logs/                                # App logs
    ├── synk.log                         # Current session log
    └── synk.log.{date}                  # Rotated logs (7 day retention)

~/.synk/worktrees/                       # GIT WORKTREES
└── {project}/
    └── {branch-slug}/                   # One worktree per agent branch

{project-root}/.synk/                    # PROJECT-LEVEL
├── config.json                          # Project config (§29)
├── blueprint.json                       # Mermaid diagrams + bindings (§19)
├── tasks.json                           # Local task queue
└── sessions.json                        # Auto-save for this project

{project-root}/CLAUDE.md                 # AI AGENT CONTEXT (§31)
```

### 34.2 Data Lifecycle

| Data | Created When | Updated When | Deleted When |
|------|-------------|-------------|-------------|
| `settings.json` | First launch | Any settings change | Never (user must manually delete) |
| `projects.json` | First launch | Project added/removed | Never |
| `pricing.json` | First launch | User edits pricing | Never |
| `.synk/config.json` | Project first opened in Synk | Config changes | User removes project files |
| `.synk/blueprint.json` | Brainstorm wizard completes | Diagram edited, node linked to task | User deletes manually |
| `.synk/tasks.json` | First task created | Task state changes | Tasks completed and cleared |
| `reviews/{id}.json` | Agent completes work | Review state changes (approve/reject) | After merge + 30 days (configurable) |
| `stats/{project}.json` | First session in project | Session ends, task completes, cost updates | Never (append-only) |
| Worktrees | Session with isolation created | Agent commits | Session closed OR merge complete |
| `CLAUDE.md` | Brainstorm export or first Synk session | Task state changes, blueprint edits | Never (user-owned file) |
| `synk.log` | App launch | Continuously | Rotated daily, 7-day retention |

### 34.3 Backup & Portability

To back up all Synk data: copy `~/.config/synk/`. To move to a new machine: copy that directory and re-install agents/CLIs. Project-level `.synk/` directories travel with the project (can be git-committed if desired, or added to `.gitignore`).

**Recommended `.gitignore` entry:**
```
.synk/sessions.json     # ephemeral session state
.synk/tasks.json        # local task state
```

**Safe to commit:**
```
.synk/config.json       # project settings (no secrets)
.synk/blueprint.json    # project architecture diagrams
CLAUDE.md               # AI context file
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

