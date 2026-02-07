# TASK 6A.1: Command Bar (Frontend)
> Phase 6 — Polish | Session A | Depends on: Phase 5

## What to Build
Spotlight/Alfred-style command bar. Press `/` in navigation mode → input appears. Autocomplete. Full command set with session targeting.

## Syntax
`/{command} [{target}] [{arguments}]`

## Targeting
- `@1` through `@12` — specific session
- `@all` — all sessions
- `@idle` — idle sessions only
- `@active` — busy sessions only
- No target — currently selected session

## Core Commands
| Command | Example | What it does |
|---------|---------|-------------|
| /new | /new claude | New session with agent type |
| /kill | /kill @3 | Kill session 3 |
| /send | /send @all run tests | Broadcast text to sessions |
| /prompt | /prompt build auth | Send to selected session |
| /task | /task Build auth system | Create new task |
| /dispatch | /dispatch @3 | Dispatch next task to session 3 |
| /goto | /goto @5 | Jump to session 5 |
| /diff | /diff @2 | Show diff for session 2 |
| /merge | /merge @2 squash | Merge session 2's branch |
| /settings | /settings | Open settings |
| /save | /save | Save session layout |

## Deliverables
1. `CommandBar.tsx` — overlay input with autocomplete dropdown
2. Parser: splits input into { command, target, args }
3. Autocomplete: after command → contextual completions (agent types, project names, strategies)
4. Calls appropriate Tauri commands via IPC
5. Result shown inline for 2 seconds ("✅ Task created" / "❌ Not found")
6. Closes on Enter (execute) or Escape (cancel)

## Files to Create/Modify
```
src/components/workspace/CommandBar.tsx (new)
src/lib/keybindings.ts                 (add / trigger)
```

## Acceptance Test
Press `/` → command bar appears. Type `/new claude` → new Claude session created. `/send @all echo hello` → all sessions receive text. Autocomplete suggests commands as you type.

---
## SPEC REFERENCE (Read all of this carefully)
## 31. Command Bar

### 31.1 Overview

The command bar is a **Spotlight/Alfred-style** text input that appears when you press `/` in navigation mode. It's the keyboard-first way to do everything in Synk without reaching for the mouse.

### 31.2 Syntax

```
/{command} [{target}] [{arguments}]
```

**Target syntax for sessions:**
- `@1` through `@12` — target a specific session by number
- `@all` — target all sessions (broadcast)
- `@idle` — target all idle sessions
- `@active` — target all currently working sessions
- No target — applies to the currently selected session

### 31.3 Command List

**Session commands:**
| Command | Example | Description |
|---------|---------|-------------|
| `/new` | `/new claude` | New session with specified agent type |
| `/new` | `/new gemini feat/api` | New session with agent + branch |
| `/kill` | `/kill @3` | Kill session 3 |
| `/kill` | `/kill @all` | Kill all sessions |
| `/restart` | `/restart @2` | Restart session 2 (kill + respawn same config) |
| `/clear` | `/clear` | Clear terminal scrollback on selected pane |

**Prompt dispatch:**
| Command | Example | Description |
|---------|---------|-------------|
| `/send` | `/send @1 build the auth module` | Send text to session 1's PTY |
| `/send` | `/send @all please run tests` | Broadcast to all sessions |
| `/send` | `/send @idle start the next task` | Send to all idle sessions |
| `/prompt` | `/prompt build user authentication` | Send to currently selected session |

**Task commands:**
| Command | Example | Description |
|---------|---------|-------------|
| `/task` | `/task Build auth system` | Create new task with title |
| `/dispatch` | `/dispatch` | Dispatch next queued task to an idle session |
| `/dispatch` | `/dispatch @3` | Dispatch next task specifically to session 3 |

**Navigation:**
| Command | Example | Description |
|---------|---------|-------------|
| `/goto` | `/goto @5` | Jump to session 5 (same as pressing `5`) |
| `/project` | `/project grid-betting` | Switch to project |
| `/settings` | `/settings` | Open settings |
| `/review` | `/review` | Open review queue |
| `/blueprint` | `/blueprint` | Toggle Mermaid planner |

**Git:**
| Command | Example | Description |
|---------|---------|-------------|
| `/branch` | `/branch @2 feat/auth` | Set branch for session 2 |
| `/diff` | `/diff @2` | Show diff for session 2's branch |
| `/merge` | `/merge @2 squash` | Merge session 2's branch with squash strategy |

**System:**
| Command | Example | Description |
|---------|---------|-------------|
| `/save` | `/save` | Save current session layout |
| `/load` | `/load my-layout` | Load saved session layout |
| `/doctor` | `/doctor` | Run Gastown health check (if in Gastown mode) |

### 31.4 Autocomplete

As you type, the command bar shows a dropdown of matching commands with descriptions. After typing a command, it shows contextual completions:
- After `/new` → agent types: `claude`, `gemini`, `codex`, `terminal`
- After `/project` → project names from `projects.json`
- After `/send @` → session numbers + `all`, `idle`, `active`
- After `/merge` → merge strategies: `merge`, `squash`, `rebase`
- After `/load` → saved session names

### 31.5 Implementation Notes

The command bar is a React component that:
1. Captures all input when open (prevents keys from reaching navigation handler)
2. Parses the input string into `{ command, target, args }`
3. Calls the appropriate Tauri command (same IPC commands from §26)
4. Closes automatically after execution (or on Escape)
5. Shows result inline for 2 seconds ("✅ Task created" / "❌ Session 3 not found")

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


