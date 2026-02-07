# TASK 4B.2: Gastown Setup Wizard UI (Frontend)
> Phase 4 — Orchestration | Session B (Frontend) | Depends on: Task 4A.3

## What to Build
Step-by-step setup wizard for Gastown integration. Shows embedded terminal panes running gt commands so user sees everything happening.

## Steps
1. ✅/❌ CLI Detection — shows gt version or install instructions
2. ✅/❌ Workspace Check — ~/gt/ exists or create it
3. Terminal pane: `gt rig add {project-name}` — user watches it run
4. Terminal pane: `gt doctor` — health check output visible
5. Summary: all green → "Gastown Ready!"

## Deliverables
1. `GastownSetupWizard.tsx` — multi-step wizard with progress bar
2. `GastownDiagnostics.tsx` — reusable status check display (✅/❌ per item)
3. Embedded terminal panes for steps 3 & 4 (reuse SessionPane component)
4. Calls backend setup wizard commands (Task 4A.3)

## Files to Create/Modify
```
src/components/gastown/GastownSetupWizard.tsx (new)
src/components/gastown/GastownDiagnostics.tsx (new)
```

## Acceptance Test
Open Gastown setup. Step 1 shows gt CLI status. Step 3 shows terminal running `gt rig add`. All visible. Complete wizard → Gastown mode becomes available in sidebar.

---
## SPEC REFERENCE (Read all of this carefully)
## 15. Gastown Integration Architecture

### 15.1 Integration Strategy: Medium Depth

**Reads:** File system watching on `~/gt/` directory for real-time state (bead status, convoy progress, polecat lifecycle, hook state). Falls back to CLI parsing (`gt convoy list --json`, `bd list --json`) if file structure changes.

**Writes:** All mutations go through `gt` and `bd` CLI commands. Synk never writes directly to Gastown's file system.

```
┌─────────────────────────────────────────────────────────────────┐
│                          SYNK                                   │
│                                                                 │
│  ┌──────────────────┐         ┌──────────────────────────────┐ │
│  │ File Watcher     │◀───────▶│ ~/gt/ (Gastown workspace)    │ │
│  │ (inotify/notify) │  reads  │  ├── .beads/ (bead ledger)   │ │
│  │                  │         │  ├── <rig>/                   │ │
│  │ Watches:         │         │  │   ├── polecats/            │ │
│  │  • bead changes  │         │  │   ├── hooks/               │ │
│  │  • convoy state  │         │  │   ├── crew/                │ │
│  │  • polecat dirs  │         │  │   └── settings/            │ │
│  │  • hook updates  │         │  └── .gt/ (config)            │ │
│  └────────┬─────────┘         └──────────────────────────────┘ │
│           │                                                     │
│           │ events                                              │
│           ▼                                                     │
│  ┌──────────────────┐         ┌──────────────────────────────┐ │
│  │ State Reconciler │────────▶│ Synk UI                      │ │
│  │                  │ updates │  • Task Queue (convoy/beads)  │ │
│  │ Maps Gastown     │         │  • Agent Status (polecats)    │ │
│  │ state → Synk     │         │  • Git Activity (hooks)       │ │
│  │ UI state         │         │  • Review Queue (refinery)    │ │
│  └──────────────────┘         └──────────────────────────────┘ │
│                                                                 │
│  ┌──────────────────┐         ┌──────────────────────────────┐ │
│  │ CLI Executor     │────────▶│ gt / bd CLIs                 │ │
│  │                  │  runs   │                              │ │
│  │ User actions  →  │         │  gt sling <bead> <rig> --naked│ │
│  │ Synk translates  │         │  gt convoy create ...        │ │
│  │ to gt/bd commands│         │  bd create --title ...       │ │
│  └──────────────────┘         └──────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 15.2 Concept Mapping: Gastown → Synk UI

| Gastown Concept | Gastown Term | Synk UI Element | Data Source |
|----------------|-------------|-----------------|-------------|
| Workspace | Town (`~/gt/`) | Global config in Settings | `~/gt/.gt/config.json` |
| Project | Rig | Project Selector (sidebar) | `gt rig list` |
| AI Coordinator | Mayor | Dedicated session pane (pane #1) | `gt mayor attach` in PTY |
| Worker agent | Polecat | Auto-spawned session pane in grid | `gt sling --naked` |
| Your workspace | Crew | User's session pane | `gt crew add` |
| Task group | Convoy | Task Queue panel (bottom drawer) | `.beads/` + `gt convoy list` |
| Individual task | Bead | Task card in Task Queue | `bd list`, `bd show <id>` |
| Persistent state | Hook | Invisible (Gastown internal) | Agents manage their own hooks |
| Worker monitor | Witness | Agent Status Overview (sidebar) | File watch on polecat dirs |
| Merge queue | Refinery | Review Queue (bottom drawer) | `gt refinery queue` |
| Agent messaging | Mail | Not directly exposed (Gastown internal) | Agents use `gt mail` internally |
| Reusable workflow | Formula | Could map to Synk templates (future) | `bd formula list` |

### 15.3 Naked Mode: Synk Replaces tmux

Gastown normally spawns polecat agents into tmux sessions. Synk uses the `--naked` flag (a supported Gastown feature) to skip tmux and capture the agent process directly in Synk's PTY.

**Spawn Flow:**
```
User clicks "Dispatch Task" in Synk UI
    │
    ▼
Synk runs: bd create --title "Build auth system" --prefix <rig>
    │         → returns bead ID (e.g., gt-abc12)
    ▼
Synk runs: gt convoy create "Auth Feature" gt-abc12
    │         → creates convoy, returns convoy ID
    ▼
Synk runs: gt sling gt-abc12 myproject --naked
    │         → Gastown creates polecat directory
    │         → Sets up git worktree
    │         → Attaches hook with bead
    │         → Spawns agent process (NO tmux)
    │         → Returns: agent command + working directory
    ▼
Synk captures spawned process in new PTY
    │         → Creates new grid pane
    │         → Attaches xterm.js renderer
    │         → Pane header shows: polecat name, bead ID, branch
    ▼
Agent reads hook → starts working (GUPP principle)
    │
    ▼
Synk file watcher detects bead status changes
    │         → Updates task card in Task Queue
    │         → Updates agent status dot in sidebar
    ▼
Agent finishes → bead marked complete
    │         → Synk moves task to "Review" status
    │         → Review Queue gets new entry
    ▼
Refinery processes merge → Synk shows result in Review Queue
```

### 15.4 First-Time Setup Wizard (Gastown Mode)

When a user selects Gastown orchestration mode for the first time, Synk runs a guided setup. Every `gt` command executes in a **visible terminal pane** so the user sees what's happening.

```
Step 1: Detect CLI
  → Check: which gt && gt --version
  → Check: which bd && bd --version
  → If missing: show install commands with copy buttons
    $ go install github.com/steveyegge/gastown/cmd/gt@latest
    $ go install github.com/steveyegge/beads/cmd/bd@latest

Step 2: Workspace
  → Check: does ~/gt/ exist?
  → If no: [Create Workspace] → runs gt install ~/gt --git (in visible pane)
  → If yes: proceed to Step 3

Step 3: Add Project as Rig
  → Auto-detect project name and repo URL from .git/config
  → User confirms rig name
  → [Add as Rig] → runs gt rig add <name> <repo-url> (in visible pane)

Step 4: Health Check
  → Runs gt doctor (in visible pane)
  → Shows results: ✅ or ❌ per check
  → If issues: offer [Auto-Fix] → runs gt doctor --fix
  → All green: 🟢 "Gastown is ready!" → [Launch Workspace]
```

Key principle: **every `gt` command runs in a visible terminal pane** — Synk guides but never hides what's happening. This teaches the user Gastown while setting it up.

### 15.5 Runtime: Synk ↔ Gastown Command Mapping

| Synk UI Action | gt/bd Command(s) | Notes |
|---------------|-------------------|-------|
| Create task | `bd create --title "..." --prefix <rig>` | Returns bead ID |
| Group tasks | `gt convoy create "name" <bead-ids>` | Creates convoy |
| Dispatch task | `gt sling <bead> <rig> --naked` | Spawns polecat into Synk PTY |
| Check status | File watch on `~/gt/` OR `gt convoy list` | Primary: file watch. Fallback: CLI |
| View all agents | `gt agents` OR file watch on polecat dirs | Shows in sidebar |
| Nudge stuck agent | `gt nudge <agent> "message"` | Sends message to agent |
| Peek at agent | `gt peek <agent>` | Health check |
| Start Mayor | `gt mayor attach` (in dedicated PTY pane) | Pane #1 in grid |
| View merge queue | `gt refinery queue` | Shows in Review Queue |
| Run health check | `gt doctor` | Shown in settings/diagnostics |
| Auto-repair | `gt doctor --fix` | User-triggered |
| Kill polecat | `gt polecat kill <name>` + close Synk pane | Cleanup both sides |
| View convoy details | `gt convoy show <id>` | Expanded task group view |
| View bead details | `bd show <id>` | Expanded task card |

### 15.6 State Reconciliation

Synk maintains its own UI state store (Zustand) that mirrors Gastown's file-based state. The reconciler keeps them in sync:

**Primary mechanism:** Rust `notify` crate watches `~/gt/` directory tree with inotify. On file change → parse structured data (JSON/TOML) → diff against current Synk state → emit Tauri event with delta → Zustand store updates → React re-renders.

**Polling fallback:** If file watching fails or misses events, background poll every 5 seconds:
- `gt convoy list` → reconcile task/convoy state
- `gt agents` → reconcile agent state  
- `bd list --status=in_progress` → reconcile active work

**Watched paths and their UI mappings:**

| File/Directory | Change Type | UI Update |
|---------------|-------------|-----------|
| `.beads/<rig>/*.json` | Bead created/modified | Task card added/updated in Task Queue |
| `<rig>/polecats/*/` | Directory created/removed | Session pane added/removed from grid |
| `<rig>/polecats/*/hooks/` | Hook file changed | Agent status updated in sidebar |
| `.gt/convoys/` | Convoy file changed | Convoy group updated in Task Queue |
| `<rig>/settings/` | Config changed | Rig settings refreshed |

### 15.7 Error Handling & Edge Cases

| Scenario | Synk Behavior |
|----------|--------------|
| `gt` CLI not installed | Gastown mode disabled in UI. Show install instructions. |
| `gt` installed but no workspace | Trigger setup wizard on mode selection. |
| Polecat crashes mid-task | File watcher detects hook state → pane status → "error" → notification with re-sling option. |
| Gastown workspace corrupted | `gt doctor` in diagnostics → offer `gt doctor --fix`. |
| Bead ledger conflict | `bd sync` to reconcile → surface error in task queue if unresolvable. |
| User switches Gastown → Manual mode | Polecats keep running (just PTY processes). Task queue switches to local-only. |
| Gastown updates to new version | Version check on startup. Warn if `gt --version` doesn't match pinned v0.3.x. CLI fallback still works. |
| Agent finishes while Synk wasn't watching | Next poll cycle catches state change (5s max delay). |
| 12 sessions full, new task dispatched | Queue task, show notification "All sessions busy — task queued". |

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


