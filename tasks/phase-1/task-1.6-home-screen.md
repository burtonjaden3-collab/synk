# TASK 1.6: Home Screen
> Phase 1 — Foundation | Single Session | Depends on: Task 1.4

## Status
Completed (2026-02-08). Home screen, recent projects persistence, and native folder picker are wired; "New Project" is present but the wizard is deferred to later phases.

## What to Build
Home screen that shows on app launch. Recent projects list (from projects.json), "New Project" and "Open Folder" buttons, dashboard stats placeholder. Routing between Home Screen and Workspace.

## Deliverables
1. `HomeScreen.tsx` — main home screen layout
2. `DashboardStats.tsx` — placeholder stats cards (will be implemented later)
3. App routing: home screen ↔ workspace (when project is selected)
4. Read/write `~/.config/synk/projects.json` for recent projects
5. "Open Folder" → native file dialog → creates .synk/ inside selected dir → switches to workspace

## Files to Create/Modify
```
src/components/home/HomeScreen.tsx     (new)
src/components/home/DashboardStats.tsx (new — placeholder)
src/App.tsx                            (add routing: home ↔ workspace)
src/lib/store.ts                       (new — Zustand store with currentProject)
src-tauri/src/commands/persistence.rs  (new — read/write projects.json)
```

## Acceptance Test
App opens → Home Screen visible. Shows "No recent projects" initially. Click "Open Folder" → select directory → app transitions to workspace with empty terminal grid. Re-open app → project shows in recent list.

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


## 28. Project Configuration

### 28.1 What is a "Project"?

A project in Synk is simply a **directory on disk that contains code** (usually with a `.git/` folder). Synk doesn't require any special file to exist — you can point it at any folder. However, Synk creates a `.synk/` directory inside the project root to store project-level configuration.

```
my-project/
├── .git/                    # existing git repo
├── .synk/                   # created by Synk on first open
│   ├── config.json          # project-level settings
│   ├── blueprint.json       # Mermaid diagrams + node bindings
│   ├── tasks.json           # local task queue (Manual mode)
│   └── sessions.json        # last session layout snapshot
├── CLAUDE.md                # generated/updated by Synk for AI context
├── src/
└── ...
```

### 28.2 Project-Level vs. Global Config

| Setting | Level | Location | Example |
|---------|-------|----------|---------|
| API keys | Global | `~/.config/synk/settings.json` | Anthropic API key |
| Default AI provider | Global | `~/.config/synk/settings.json` | "anthropic" |
| Model pricing table | Global | `~/.config/synk/pricing.json` | Opus = $15/$75 per MT |
| Pool size / performance | Global | `~/.config/synk/settings.json` | initial_pool_size: 3 |
| Keyboard shortcut overrides | Global | `~/.config/synk/settings.json` | escape_method: "double_escape" |
| Orchestration mode | **Project** | `.synk/config.json` | "gastown" |
| Default agent type | **Project** | `.synk/config.json` | "claude_code" |
| Default branch | **Project** | `.synk/config.json` | "main" |
| Worktree isolation default | **Project** | `.synk/config.json` | true |
| Gastown rig name | **Project** | `.synk/config.json` | "grid-betting" |
| Skills overrides | **Project** | `.synk/config.json` | enabled/disabled list |
| MCP server overrides | **Project** | `.synk/config.json` | enabled/disabled list |
| Blueprint diagrams | **Project** | `.synk/blueprint.json` | Mermaid source + bindings |
| Task list (Manual mode) | **Project** | `.synk/tasks.json` | local task queue |
| Session layout | **Project** | `.synk/sessions.json` | grid arrangement + agent types |
| Auto-dispatch enabled | **Project** | `.synk/config.json` | true |
| Auto-save enabled | **Project** | `.synk/config.json` | true |

### 28.3 `.synk/config.json` Schema

```json
{
  "version": 1,
  "project_name": "grid-betting",
  "project_path": "/home/jaden/projects/grid-betting",
  "orchestration_mode": "gastown",
  "default_agent_type": "claude_code",
  "default_base_branch": "main",
  "worktree_isolation_default": true,
  "auto_dispatch": true,
  "auto_save": true,
  "gastown": {
    "rig_name": "grid-betting",
    "workspace_path": "~/gt/"
  },
  "skills": {
    "enabled": ["skill-name-1", "skill-name-2"],
    "disabled": ["skill-name-3"]
  },
  "mcp_servers": {
    "enabled": ["server-1"],
    "disabled": ["server-2"]
  },
  "created_at": "2026-02-06T18:00:00Z",
  "last_opened": "2026-02-06T22:30:00Z"
}
```

### 28.4 Project Discovery

Synk tracks known projects in `~/.config/synk/projects.json`:

```json
{
  "projects": [
    {
      "path": "/home/jaden/projects/grid-betting",
      "name": "grid-betting",
      "last_opened": "2026-02-06T22:30:00Z",
      "orchestration_mode": "gastown"
    },
    {
      "path": "/home/jaden/projects/silver-tracker",
      "name": "silver-tracker",
      "last_opened": "2026-02-05T14:00:00Z",
      "orchestration_mode": "manual"
    }
  ]
}
```

**Adding a project:**
1. **New Project button** → Brainstorm wizard → scaffolds directory → auto-adds to projects list
2. **Open Folder** → file picker → user selects existing directory → Synk creates `.synk/` inside it → adds to projects list
3. **.synk/ detection** (future): if user opens a folder that already has `.synk/`, Synk reads existing config

**Removing a project:** Right-click in project selector → "Remove from Synk" → removes from `projects.json` but does NOT delete `.synk/` or any project files.

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
