# TASK 6C.2: Dashboard Stats (Frontend)
> Phase 6 — Polish | Session C | Depends on: Phase 5

## What to Build
Implement the dashboard stats cards on the Home Screen. Show aggregate statistics per project and overall.

## Stats to Show
- Total sessions launched (all time)
- Total tasks completed
- Total estimated cost across all sessions
- Estimated hours saved (heuristic: tasks × average human time estimate)
- Most used agent type
- Current streak (consecutive days using Synk)

## Data Source
Read from `~/.config/synk/stats/{project}.json` — append-only stats file updated when sessions end and tasks complete.

## Deliverables
1. `DashboardStats.tsx` — replace placeholder with real stats cards
2. Stats collection: update stats file on session end + task completion
3. `commands/persistence.rs` — extend with stats read/write
4. Cards: clean design matching UI spec, numbers with labels, subtle animations on load

## Files to Create/Modify
```
src/components/home/DashboardStats.tsx     (replace placeholder)
src-tauri/src/commands/persistence.rs      (extend with stats)
```

## Acceptance Test
Complete a few sessions and tasks. Go to home screen → stats cards show correct numbers. Switch projects → stats update for that project.

---
## SPEC REFERENCE (Read all of this carefully)
## 4. App Modes & Screens

### 4.1 Home Screen (Launch)

The first thing the user sees on app open:

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                    [App Logo / Name]                             │
│                                                                 │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐│
│  │                      │  │                                  ││
│  │   [+ New Project]    │  │   📊 Dashboard                   ││
│  │                      │  │                                  ││
│  │   Starts brainstorm  │  │   Total sessions: 47             ││
│  │   wizard             │  │   Total cost: $34.21             ││
│  │                      │  │   Tasks completed: 128           ││
│  └──────────────────────┘  │   Hours saved (est): ~64         ││
│                            │                                  ││
│  ┌──────────────────────┐  └──────────────────────────────────┘│
│  │   Recent Projects    │                                      │
│  │                      │                                      │
│  │   📁 grid-betting        last opened 2h ago                │
│  │   📁 silver-tracker      last opened 1d ago                │
│  │   📁 portfolio-site      last opened 3d ago                │
│  │                      │                                      │
│  └──────────────────────┘                                      │
└─────────────────────────────────────────────────────────────────┘
```

- **New Project** → enters brainstorm wizard (full-screen)
- **Recent Projects** → opens project directly into workspace with last-used mode
- **Dashboard** → aggregate stats across all past sessions

### 4.2 Brainstorm Wizard (New Projects Only)

Full-screen experience triggered by "New Project":

**Step 1 — Conversational Brainstorm**
- Chat interface with the AI (user picks which provider: Anthropic, Google, OpenAI, or local Ollama)
- User describes what they want to build in plain English
- AI asks clarifying questions, refines understanding
- AI extracts structured data from the conversation in real-time:
  - Project name
  - Description
  - Tech stack
  - Core features
  - Target platform
  - Key entities / data models

**Step 2 — Blueprint Generation**
AI generates a comprehensive project blueprint consisting of:

| Blueprint Layer | Content | Mermaid Diagram Type |
|----------------|---------|---------------------|
| System Architecture | Components, services, data flow | `flowchart` or `C4Context` |
| File/Folder Structure | Directory tree, key files | `graph TD` (tree layout) |
| Database Schema | Tables, relationships, fields | `erDiagram` |
| API Routes | Endpoints, methods, request/response | `flowchart LR` |
| Deployment | Infrastructure, CI/CD, hosting | `flowchart` |

All rendered as interactive Mermaid diagrams with a live preview panel.

**Step 3 — Refinement**
- User can edit any diagram manually (Mermaid code editor + visual preview)
- Can chat with AI to request changes ("add a Redis cache layer", "split the auth into its own microservice")
- Each change re-renders in real-time

**Step 4 — Export & Launch**
All five export options:
1. **Markdown doc** — full blueprint as a readable document
2. **CLAUDE.md** — project context file optimized for AI agents to consume
3. **Gastown convoys** — tasks exported directly into Gastown's task queue
4. **Scaffolded directories** — actually creates the file/folder structure on disk
5. **Reusable template** — save the blueprint for future projects with similar structure

After export → transitions to the main workspace with sessions ready to launch.

### 4.3 Main Workspace (Existing Projects)

The primary working view with all panels:

**Floating Mermaid Panel:**
- Toggleable with hotkey (e.g., `m`)
- Shows the living project blueprint
- Nodes update status as agents complete tasks:
  - ⬜ Not started
  - 🔵 In progress
  - 🟢 Complete
  - 🔴 Failed/blocked
- Can add/edit/remove nodes on the fly
- Draggable, resizable, can be pinned or floating

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


