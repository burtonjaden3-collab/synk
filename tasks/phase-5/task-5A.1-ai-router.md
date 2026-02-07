# TASK 5A.1: AI Provider Router (Backend)
> Phase 5 — Brainstorm Wizard | Session A (Backend) | Depends on: Phase 4

## What to Build
AI provider abstraction layer: provider trait with streaming support, implementations for all 4 providers (Anthropic, Google, OpenAI, Ollama), dual auth (API key + OAuth), SSE streaming parser.

## Provider Trait
```rust
#[async_trait]
pub trait AiProvider: Send + Sync {
    fn name(&self) -> &str;
    async fn complete(&self, messages: &[ChatMessage], system: &str) -> Result<String>;
    async fn stream(&self, messages: &[ChatMessage], system: &str) -> Result<StreamHandle>;
    async fn validate_auth(&self) -> Result<bool>;
}
```

## All 4 Providers Use Raw reqwest
No SDKs. Direct HTTP with SSE parsing. This keeps the binary small.

## Streaming Pipeline
Rust SSE parsing → Tauri events → React renders tokens as they arrive

## Deliverables
1. `ai/mod.rs` — AiProvider trait + ChatMessage types
2. `ai/anthropic.rs` — Messages API, x-api-key or OAuth Bearer
3. `ai/google.rs` — Gemini API, ?key= or OAuth
4. `ai/openai.rs` — Chat Completions, Bearer token
5. `ai/ollama.rs` — Local REST, no auth
6. `commands/ai_provider.rs` — Tauri commands: ai:chat_stream, ai:validate_key, ai:oauth_start/callback
7. SSE parser that emits ai:stream_chunk events per token

## Files to Create/Modify
```
src-tauri/src/ai/mod.rs            (new)
src-tauri/src/ai/anthropic.rs      (new)
src-tauri/src/ai/google.rs         (new)
src-tauri/src/ai/openai.rs         (new)
src-tauri/src/ai/ollama.rs         (new)
src-tauri/src/commands/ai_provider.rs (new)
```

## Acceptance Test
Call ai:chat_stream with Anthropic provider → tokens stream in via events. Switch to Ollama → local model responds. Validate key → returns true/false. Invalid key → clear error.

---
## SPEC REFERENCE (Read all of this carefully)
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


