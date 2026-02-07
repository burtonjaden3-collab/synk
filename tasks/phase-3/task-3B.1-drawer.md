# TASK 3B.1: Bottom Drawer Shell (Frontend)
> Phase 3 — Git Integration | Session B (Frontend) | Depends on: Phase 2

## What to Build
Resizable bottom drawer with draggable/rearrangeable panel tabs. This is the container — panel contents will be added in later tasks.

## Panels (create empty tab placeholders for now)
1. 💰 Cost Tracker
2. 📊 Git Activity
3. 📋 Task Queue
4. 🔍 Review Queue

## Deliverables
1. `BottomDrawer.tsx` — resizable container at bottom of workspace
2. Drag handle to resize vertically (default height: 250px)
3. Tab bar with 4 tabs — drag to rearrange order
4. Click tab to switch panel content
5. Double-click drag handle or keyboard shortcut to collapse/expand
6. Panel order saved to settings

## Files to Create/Modify
```
src/components/drawer/BottomDrawer.tsx  (new)
src/components/workspace/Workspace.tsx  (add drawer below grid)
```

## Acceptance Test
Drawer visible at bottom. 4 tabs clickable. Drag to resize. Drag tabs to reorder. Collapse/expand works. Empty content area per tab.

---
## SPEC REFERENCE (Read all of this carefully)
## 6. Bottom Drawer (Draggable Panels)

Resizable drawer that slides up from the bottom. Contains **4 draggable/rearrangeable panels** the user can customize:

### 6.1 Token / Cost Tracker 💰
- Per-session cost display (model, input tokens, output tokens, cost)
- Running total across all sessions
- Cost graph over time (line chart)
- Supports parsing cost output from: Claude Code, Gemini CLI, Codex
- Configurable model pricing (user can update $/token rates)

### 6.2 Git Activity Feed 🔀
- Real-time feed of git events across all sessions:
  - Commits (hash, message, branch, session)
  - Branch creation/deletion
  - Merge events
  - Conflicts detected
- Clickable entries to jump to diff view
- Filter by session or branch

### 6.3 Task Queue / Progress Tracker 📋
- Visual task board (kanban-style or list):
  - **Queued** → **Dispatched** → **In Progress** → **Review** → **Done**
- Each task shows: title, assigned agent, priority, dependencies
- Drag to reorder priority
- Click to expand details
- "Add Task" inline form
- In Gastown mode: maps to convoys/beads
- In Manual mode: simple local task list

### 6.4 Review Queue ✅
- List of agent-completed work ready for human review
- Each item shows: branch name, files changed, additions/deletions
- Click to open full PR-style review:
  - Side-by-side diff viewer
  - Line-level commenting
  - Approve → triggers merge
  - Reject → returns to task queue with comments
  - Request Changes → sends feedback prompt to agent
- Merge strategy selector (merge commit, squash, rebase)
- Conflict detection and warning before merge

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


