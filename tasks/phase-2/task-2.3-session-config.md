# TASK 2.3: Per-Session Configuration
> Phase 2 — Sidebar & Config | Single Session | Depends on: Task 2.1 + 2.2
>
> Status: ✅ Completed (2026-02-08)

## What to Build
Click a session in the sidebar → see/edit its configuration: agent type, branch name, worktree toggle, which skills are enabled, which MCP servers to use. Save per-session config to .synk/config.json.

## Deliverables
1. `SessionConfig.tsx` — config panel that slides in when clicking a session in sidebar
2. Fields: agent type dropdown, branch name input, worktree isolation toggle, skills checkboxes, MCP checkboxes
3. Changes save to `.synk/config.json` under a sessions key
4. `persistence.rs` — Tauri commands to read/write .synk/config.json
5. Zustand store updated with session config state

## Files to Create/Modify
```
src/components/sidebar/SessionConfig.tsx    (new)
src-tauri/src/commands/persistence.rs       (new — read/write .synk/config.json)
src/lib/store.ts                            (add session config state)
```

## Acceptance Test
Click session in sidebar → config panel appears. Change branch name → saves to .synk/config.json. Toggle a skill → persists across app restart.

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

