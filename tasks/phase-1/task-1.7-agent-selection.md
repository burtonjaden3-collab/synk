# TASK 1.7: Agent Mode Selection
> Phase 1 — Foundation | Single Session | Depends on: Task 1.3

## What to Build
When creating a session, user picks an agent type. Auto-detect which agents are installed on the system. Launch the correct command in the PTY.

## Agent Types
| Agent | Command | Detection |
|-------|---------|-----------|
| Claude Code | `claude` | `which claude` |
| Gemini CLI | `gemini` | `which gemini` |
| OpenAI Codex | `codex` | `which codex` |
| Plain Terminal | `$SHELL` | Always available |

## Deliverables
1. Agent detection: run `which` for each agent on startup, store results
2. `session:create` accepts `agentType` parameter (camelCase on the wire; backend can use serde rename/aliases)
3. Session manager launches correct command based on agent type
4. Pane header shows agent badge (icon + name) and colored status dot
5. If selected agent not installed → show warning, offer Terminal fallback

## Files to Create/Modify
```
src-tauri/src/core/session_manager.rs  (add agent type handling on create_session; accept agentType on wire)
src-tauri/src/commands/session.rs      (accept agentType on the wire; support agent_type as an alias in Rust)
src-tauri/src/core/agent_detection.rs  (new — detect installed agents)
src/components/workspace/SessionPane.tsx (agent badge in header)
src/lib/types.ts                       (AgentType enum)
```

## Acceptance Test
Create session with type "claude_code" → `claude` command runs. Type "terminal" → default shell runs. Request "gemini" when not installed → warning shown, falls back to terminal.

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
