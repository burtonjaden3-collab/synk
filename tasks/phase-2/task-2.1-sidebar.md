# TASK 2.1: Sidebar Shell
> Phase 2 — Sidebar & Config | Single Session | Depends on: Task 1.4
>
> Status: ✅ Completed (2026-02-08)

## What to Build
Collapsible left sidebar with section headers. Contains: project selector dropdown, orchestrator mode selector (UI only — no backend logic yet), session list showing active sessions.

## Deliverables
1. `Sidebar.tsx` — collapsible container (toggle with `Ctrl+e` or click)
2. `ProjectSelector.tsx` — dropdown of known projects from projects.json
3. `OrchestratorControls.tsx` — skeleton: mode selector (Gastown/Agent Teams/Manual) with radio buttons, non-functional for now
4. `AgentStatusOverview.tsx` — list of active sessions with agent type badge, status dot, branch name
5. Sidebar width: 280px default, collapsible to 0
6. Dark background (#181825), subtle border separator

## Files to Create/Modify
```
src/components/sidebar/Sidebar.tsx              (new)
src/components/sidebar/ProjectSelector.tsx      (new)
src/components/sidebar/OrchestratorControls.tsx (new — skeleton)
src/components/sidebar/AgentStatusOverview.tsx  (new)
src/components/workspace/Workspace.tsx          (add sidebar to left of grid)
src/lib/keybindings.ts                          (add Ctrl+e toggle)
```

## Acceptance Test
Sidebar visible on left. Shows project name, mode selector (clickable but no effect), list of active sessions. Ctrl+e collapses/expands. Sessions list updates when sessions are created/destroyed.

---
## SPEC REFERENCE (Read all of this carefully)
## 5. Sidebar (Left Panel)

Always-visible collapsible sidebar with these sections:

### 5.1 Project Selector
- Dropdown or list of all configured projects
- Current project highlighted
- Quick switch between projects
- "Open folder" button to add new project directories

### 5.2 Skills Browser
- Auto-detects installed Claude skills from `~/.claude/` config
- Toggle switches to enable/disable skills per session or globally
- Shows skill name, description, source (built-in vs custom)
- "Add Skill" button for manual skill registration
- Skills can be assigned per-session or applied to all

### 5.3 MCP Server Manager
- Auto-detects MCP servers from Claude config and running processes
- Toggle switches to enable/disable MCP connections
- Shows connection status (connected / disconnected / error)
- "Add MCP Server" form (name, command, args, env vars)
- Per-session MCP assignment

### 5.4 Session Configuration
For each active session:
- Agent type selector (Claude Code, Gemini CLI, OpenAI Codex, Plain Terminal)
- Branch assignment dropdown
- Worktree isolation toggle (on/off)
- Assigned skills subset
- Assigned MCP servers subset
- Quick actions (restart, kill, clear)

### 5.5 Orchestrator Controls
- Mode selector: **Gastown** | **Claude Agent Teams** | **Manual**
- Mode-specific controls:
  - *Gastown*: convoy status, agent list, sling controls
  - *Claude Agent Teams*: subagent monitor, team config
  - *Manual*: just session list, no orchestration UI
- Task queue summary (count by status)
- "Dispatch" button to send next queued task

### 5.6 Active Agent Status Overview
- Compact status cards for each running session:
  - Agent name / type icon
  - Current status: idle ● | working ● | waiting ● | done ● | error ●
  - Current branch
  - Running cost for this session
- Click to jump to that session pane

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

