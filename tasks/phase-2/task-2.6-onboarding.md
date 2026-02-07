# TASK 2.6: First Run Onboarding
> Phase 2 — Sidebar & Config | Single Session | Depends on: Task 2.5

## What to Build
First-launch wizard that appears when ~/.config/synk/ doesn't exist. 4 steps: Welcome → AI Provider Setup (dual auth) → Agent Detection → First Project.

## The 4 Steps
1. **Welcome** — branding, "Get Started" button
2. **AI Provider Setup** (skippable) — each provider: API key input OR Sign In button (OAuth). Ollama auto-detected.
3. **Agent Detection** — run `which claude/gemini/codex/gt`, show what's found with ✅/❌
4. **First Project** — "Start new project" (future: brainstorm wizard) OR "Open existing folder" (file picker)

## Skip Recovery
- No API keys? Brainstorm wizard shows "Set up a provider in Settings" with link
- No Gastown? Mode grayed out in sidebar with tooltip
- No agents? Plain Terminal always works

## Deliverables
1. `OnboardingWizard.tsx` — 4-step wizard with progress indicator
2. `ProviderSetup.tsx` — reuses Settings API provider UI but in wizard layout
3. `AgentDetection.tsx` — system scan results
4. On completion: create ~/.config/synk/ directory with defaults, add first project to projects.json
5. Never shows again after first run

## Files to Create/Modify
```
src/components/onboarding/OnboardingWizard.tsx  (new)
src/components/onboarding/ProviderSetup.tsx     (new)
src/components/onboarding/AgentDetection.tsx    (new)
src/App.tsx                                      (check first-run → route to wizard)
```

## Acceptance Test
Delete ~/.config/synk/. Launch app → wizard appears. Click through all 4 steps. Select a folder. App transitions to workspace. Relaunch → goes straight to home screen (wizard doesn't show).

---
## SPEC REFERENCE (Read all of this carefully)
## 29. First Run / Onboarding

### 29.1 First Launch Flow

When Synk opens for the very first time (`~/.config/synk/` doesn't exist):

```
Step 1: Welcome Screen
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                     Welcome to Synk                             │
│           AI Agent Command Center for Developers                │
│                                                                 │
│    Synk helps you orchestrate multiple AI coding agents         │
│    from a single visual command center.                         │
│                                                                 │
│                   [Get Started →]                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Step 2: AI Provider Setup (optional, skippable)
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│    Set up your AI providers (you can do this later)             │
│                                                                 │
│    Anthropic                                                    │
│      ○ API Key    [paste API key here          ]  ⬜            │
│      ● Sign In    [Sign in with Claude →]         ✅ Connected  │
│                                                                 │
│    Google                                                       │
│      ○ API Key    [                            ]  ⬜            │
│      ● Sign In    [Sign in with Google →]         ⬜ Skip       │
│                                                                 │
│    OpenAI                                                       │
│      ○ API Key    [                            ]  ⬜            │
│      ● Sign In    [Sign in with OpenAI →]         ⬜ Skip       │
│                                                                 │
│    Ollama        [Auto-detected at localhost  ]   ✅ Found      │
│                                                                 │
│    API keys give direct token-based billing.                    │
│    Sign-in uses your existing subscription (Pro, Advanced,      │
│    Plus) — no separate API costs.                               │
│                                                                 │
│              [Skip for now]    [Save & Continue →]              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Step 3: Agent Detection
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│    Detected coding agents on your system:                       │
│                                                                 │
│    ✅ Claude Code    v1.2.3  at /usr/local/bin/claude           │
│    ✅ Gemini CLI     v0.8.1  at /usr/local/bin/gemini           │
│    ❌ OpenAI Codex   not found                                  │
│    ✅ Terminal        /bin/bash                                  │
│                                                                 │
│    ℹ️  Orchestrators:                                            │
│    ✅ Gastown (gt)   v0.3.2  at /usr/local/bin/gt               │
│    ❌ Gastown workspace not found (can set up later)            │
│                                                                 │
│                          [Continue →]                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

Step 4: First Project
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│    Let's set up your first project:                             │
│                                                                 │
│    ○ Start a new project (opens brainstorm wizard)              │
│    ● Open an existing folder                                    │
│      [/home/jaden/projects/grid-betting      ] [Browse]         │
│                                                                 │
│                          [Launch →]                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 29.2 What Gets Created on First Run

```
~/.config/synk/
├── settings.json         # global settings with defaults
├── pricing.json          # default model pricing table
├── projects.json         # empty project list (until Step 4)
├── reviews/              # empty reviews directory
├── sessions/             # empty saved sessions directory
└── plugins/              # empty plugins directory
```

### 29.3 Subsequent Launches

After first run, Synk opens directly to the **Home Screen** (§4.1) showing recent projects and dashboard stats. The onboarding wizard never shows again (unless `~/.config/synk/` is deleted).

### 29.4 Skipped Setup Recovery

If the user skips API keys or doesn't set up Gastown during onboarding:
- **No API keys:** Brainstorm wizard shows "Set up an AI provider in Settings to use this feature" with a link to settings
- **No Gastown:** Gastown mode appears grayed out in the orchestrator selector with tooltip "Set up Gastown → Settings → Integrations"
- **No agents detected:** Session creation still works (Plain Terminal always available). Agent type selector shows which agents are missing with install hints

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


