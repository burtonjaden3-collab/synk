# TASK 1.4: Terminal Grid UI
> Phase 1 — Foundation | Single Session | Depends on: Task 1.3

## Status
Completed (2026-02-07) in `cdb32ca`.

## What to Build
React terminal grid using xterm.js. Sessions display in an auto-reflowing grid (up to 12 sessions). Each pane has a header bar showing session number. Connect to Tauri session IPC for real terminal I/O.

## Deliverables
1. `Workspace.tsx` — main workspace layout container
2. `SessionGrid.tsx` — computes grid layout from session count, renders panes
3. `SessionPane.tsx` — single pane: xterm.js terminal + header bar with session number
4. `tauri-api.ts` — typed invoke() wrappers for session commands
5. `types.ts` — TypeScript interfaces for Session, AgentType, etc.
6. Terminal output renders correctly with colors/ANSI codes
7. Terminal input sends keystrokes to PTY via session:write

## Grid Layout Rules
**Notation:** `cols×rows` (e.g. `2×1` = 2 columns side-by-side).
| Sessions | Layout |
|----------|--------|
| 1 | 1×1 (full screen) |
| 2 | 2×1 (side by side) |
| 3-4 | 2×2 |
| 5-6 | 3×2 |
| 7-9 | 3×3 |
| 10-12 | 4×3 |

## Files to Create/Modify
```
src/components/workspace/Workspace.tsx    (new)
src/components/workspace/SessionGrid.tsx  (new)
src/components/workspace/SessionPane.tsx  (new)
src/lib/tauri-api.ts                      (new)
src/lib/types.ts                          (new)
src/App.tsx                               (mount Workspace)
```

## Acceptance Test
Open app. Add sessions (temporary button or hardcoded). Grid reflows correctly. Type in a pane → see real shell output. ANSI colors render. Panes resize when window resizes.

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


## 11. UI Design Specification

### Visual Style: Clean Modern Dark (VS Code / GitHub Dark)

**Color Palette**
| Token | Value | Usage |
|-------|-------|-------|
| `--bg-primary` | `#1e1e2e` | Main background |
| `--bg-secondary` | `#252535` | Sidebar, panels |
| `--bg-tertiary` | `#2d2d3f` | Cards, pane headers |
| `--bg-hover` | `#353548` | Hover states |
| `--border` | `#3a3a4e` | Borders, dividers |
| `--text-primary` | `#e0e0e8` | Body text |
| `--text-secondary` | `#8888a0` | Muted text, labels |
| `--accent-blue` | `#58a6ff` | Primary actions, links |
| `--accent-green` | `#3fb950` | Success, approved, idle |
| `--accent-orange` | `#d29922` | Warnings, in-progress |
| `--accent-red` | `#f85149` | Errors, rejected |
| `--accent-purple` | `#bc8cff` | Agent badges, AI indicators |

**Typography**
- Terminal: `JetBrains Mono` (13px)
- App Chrome: `Geist Sans` (13px body, 12px labels)
- Mermaid Diagrams: `Geist Sans` (12px)

---


## 3. Core Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React/TypeScript)                       │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                          TOP BAR                                     │ │
│  │  [App Title]     [Command Bar (/)]     [Mode Indicator]   [⚙ Settings]│ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│  ┌────────────┬─────────────────────────────────────────────────────────┐ │
│  │            │                                                         │ │
│  │  SIDEBAR   │              SESSION GRID                               │ │
│  │            │         (xterm.js terminal panes)                       │ │
│  │ • Skills   │                                                         │ │
│  │ • MCP      │    ┌──────────┐ ┌──────────┐ ┌──────────┐             │ │
│  │ • Sessions │    │ Agent 1  │ │ Agent 2  │ │ Agent 3  │             │ │
│  │ • Orchestr.│    └──────────┘ └──────────┘ └──────────┘             │ │
│  │ • Projects │    ┌──────────┐ ┌──────────┐ ┌──────────┐             │ │
│  │ • Status   │    │ Agent 4  │ │ Agent 5  │ │ Agent 6  │             │ │
│  │            │    └──────────┘ └──────────┘ └──────────┘             │ │
│  ├────────────┴─────────────────────────────────────────────────────────┤ │
│  │                       BOTTOM DRAWER (draggable panels)               │ │
│  │  [💰 Cost Tracker] [🔀 Git Activity] [📋 Task Queue] [✅ Reviews]   │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │           FLOATING PANELS (toggle with hotkeys)                      │ │
│  │  • Mermaid Project Planner (existing projects)                       │ │
│  │  • Brainstorm Wizard (new projects — full screen)                    │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                           │
│                            Tauri IPC (invoke)                             │
└─────────────────────────────┬─────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼─────────────────────────────────────────────┐
│                         BACKEND (Rust / Tauri)                            │
│                                                                           │
│  ┌──────────────────┐  ┌────────────────────┐  ┌──────────────────────┐  │
│  │  Process Pool    │  │ Orchestrator       │  │   Git Manager        │  │
│  │  (PTY pre-warm,  │  │ Adapter Layer      │  │  (worktree, diff,    │  │
│  │   spawn, recycle)│  │                    │  │   merge, branches)   │  │
│  │                  │  │  ┌──────────────┐  │  │                      │  │
│  │                  │  │  │  Gastown     │  │  │                      │  │
│  │                  │  │  ├──────────────┤  │  │                      │  │
│  │                  │  │  │  Claude      │  │  │                      │  │
│  │                  │  │  │  Agent Teams │  │  │                      │  │
│  │                  │  │  ├──────────────┤  │  │                      │  │
│  │                  │  │  │  Manual/None │  │  │                      │  │
│  │                  │  │  └──────────────┘  │  │                      │  │
│  └──────────────────┘  └────────────────────┘  └──────────────────────┘  │
│                                                                           │
│  ┌──────────────────┐  ┌────────────────────┐  ┌──────────────────────┐  │
│  │  MCP Server      │  │ AI Provider        │  │  Session Persistence │  │
│  │  (status reports) │  │ Router             │  │  (save/restore)      │  │
│  │                  │  │ (Anthropic, Google, │  │                      │  │
│  │                  │  │  OpenAI, Ollama)    │  │                      │  │
│  └──────────────────┘  └────────────────────┘  └──────────────────────┘  │
│                                                                           │
│  ┌──────────────────┐  ┌────────────────────┐                            │
│  │  Cost Tracker    │  │ Skills & MCP       │                            │
│  │  (token parsing, │  │ Discovery          │                            │
│  │   per-session)   │  │ (auto-detect +     │                            │
│  │                  │  │  manual override)   │                            │
│  └──────────────────┘  └────────────────────┘                            │
└───────────────────────────────────────────────────────────────────────────┘
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
