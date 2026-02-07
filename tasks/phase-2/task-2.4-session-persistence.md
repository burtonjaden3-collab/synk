# TASK 2.4: Session Persistence
> Phase 2 — Sidebar & Config | Single Session | Depends on: Task 2.3

## What to Build
Save and restore session layouts. Manual save with `s` key in navigation mode. Auto-save every 60 seconds. Crash recovery on next launch.

## What Gets Saved
✅ Grid layout (session count, arrangement)
✅ Agent type per pane
✅ Branch assignments
✅ Worktree paths
✅ Skills/MCP overrides per session
✅ Task queue state
❌ Terminal scrollback (too large)
❌ Agent conversation history (agents start fresh)
❌ PTY process handles (processes are ephemeral)

## Key Principle
Restore the ENVIRONMENT, not the agent's MEMORY. On restore, each agent spawns fresh in the right directory on the right branch.

## Deliverables
1. Save session layout to `~/.config/synk/sessions/{name}.json`
2. Auto-save to `~/.config/synk/sessions/{project}-autosave.json` every 60s
3. Load saved session → recreate grid, claim PTYs, launch agents in correct directories
4. Crash recovery: detect autosave on launch → offer "Restore previous session?"
5. `s` key in navigation mode triggers manual save (prompt for name)

## Files to Create/Modify
```
src-tauri/src/commands/persistence.rs (extend with save/load session)
src/lib/store.ts                      (save/restore actions)
src/components/home/HomeScreen.tsx    (crash recovery prompt on launch)
src/lib/keybindings.ts                (add 's' key handler)
```

## Acceptance Test
Create 4 sessions with different agent types. Press `s` → save as "test-layout". Close app. Reopen → load "test-layout" → same 4 panes with correct agent types. Kill app process → reopen → "Restore?" prompt appears.

---
## SPEC REFERENCE (Read all of this carefully)
## 32. Session Persistence

### 32.1 What Gets Saved

When you save a session (manually with `s` or via auto-save), Synk captures:

```json
{
  "version": 1,
  "name": "auth-feature-sprint",
  "saved_at": "2026-02-06T22:30:00Z",
  "project_path": "/home/jaden/projects/grid-betting",
  "orchestration_mode": "gastown",
  "grid_layout": {
    "session_count": 4,
    "layout": "2x2"
  },
  "sessions": [
    {
      "pane_index": 0,
      "agent_type": "claude_code",
      "branch": "feat/auth-login",
      "worktree_enabled": true,
      "working_dir": "/home/jaden/.synk/worktrees/grid-betting/feat-auth-login",
      "skills": ["skill-1", "skill-2"],
      "mcp_servers": ["server-1"],
      "env_overrides": {}
    },
    {
      "pane_index": 1,
      "agent_type": "gemini_cli",
      "branch": "feat/auth-signup",
      "worktree_enabled": true,
      "working_dir": "/home/jaden/.synk/worktrees/grid-betting/feat-auth-signup",
      "skills": [],
      "mcp_servers": [],
      "env_overrides": {}
    }
  ],
  "task_queue_snapshot": [
    { "id": "task-1", "title": "Build dashboard", "status": "queued", "priority": "medium" }
  ]
}
```

### 32.2 What Does NOT Get Saved

| Data | Saved? | Why |
|------|--------|-----|
| Grid layout + session count | ✅ | Restore exact arrangement |
| Agent types per pane | ✅ | Know what to launch |
| Branch assignments | ✅ | Restore branch context |
| Worktree paths | ✅ | Reconnect to existing worktrees |
| Skills/MCP per session | ✅ | Restore agent configuration |
| Task queue state | ✅ | Resume where you left off |
| Terminal scrollback | ❌ | Too large, not useful after agent restart |
| Agent internal state | ❌ | Agents start fresh on restore (by design) |
| Active AI conversations | ❌ | Brainstorm state is ephemeral |
| PTY process handles | ❌ | Processes die on close, new ones spawn on restore |

### 32.3 Restore Behavior

When loading a saved session:

1. Synk reads the saved layout file
2. Creates the correct number of grid panes
3. For each session:
   a. Claims a PTY from the process pool
   b. `cd` to the working directory (if worktree still exists)
   c. Launches the agent command (agent starts fresh)
   d. If worktree no longer exists: create it (if branch still exists) or skip with warning
4. Restores task queue state
5. Notification: "Session restored: 4 panes, 2 tasks queued"

**Key principle:** Agents always start fresh. Synk restores the _environment_ (directory, branch, config) but not the agent's _conversation history_. This is intentional — it's cleaner to give agents a fresh start with the current CLAUDE.md context than to try to resume mid-conversation.

### 32.4 Auto-Save

When enabled (default: on), Synk auto-saves the current session layout every 60 seconds to `.synk/sessions.json` inside the project. On unexpected crash → next launch detects the auto-save and offers "Restore previous session?" on the home screen.

### 32.5 Storage Location

```
~/.config/synk/sessions/
├── auth-feature-sprint.json     # named saves (user-created)
├── grid-betting-autosave.json   # auto-save (one per project)
└── silver-tracker-autosave.json
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


