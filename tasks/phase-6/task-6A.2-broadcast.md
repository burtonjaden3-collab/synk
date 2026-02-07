# TASK 6A.2: Broadcast Mode (Frontend)
> Phase 6 — Polish | Session A | Depends on: Task 6A.1

## What to Build
Broadcast mode: send the same input to multiple terminal sessions simultaneously. Toggle with Ctrl+b.

## Two Modes
1. **Sustained broadcast** (Ctrl+b toggle): every keystroke goes to all target panes until toggled off
2. **One-shot** (command bar `/send @all {text}`): sends string once, no mode change

## Visual Indicators
- Active: red "BROADCAST" badge in top bar
- Target panes get red borders
- Badge shows: "BROADCAST → 6 sessions"

## Targeting
- Default: all sessions
- `/send @idle` — only idle agents
- `/send @active` — only busy agents
- `/send @1,@3,@5` — specific sessions

## Deliverables
1. Broadcast state in Workspace component
2. Ctrl+b toggle handler
3. Red border styling on target panes when active
4. "BROADCAST" badge component
5. Key forwarding: when broadcast active, every keystroke written to all target PTYs
6. First-use tooltip: "Broadcast works best when agents are at a shell prompt"

## Files to Create/Modify
```
src/components/workspace/Workspace.tsx   (broadcast state + key forwarding)
src/components/workspace/SessionPane.tsx (red border when broadcast target)
src/lib/keybindings.ts                   (Ctrl+b handler)
```

## Acceptance Test
Ctrl+b → red badge + red borders. Type "ls" → appears in all terminals. Ctrl+b again → badge disappears, normal mode. `/send @idle echo test` → only idle sessions receive text.

---
## SPEC REFERENCE (Read all of this carefully)
## 38. Broadcast Mode

### 38.1 What It Does

Broadcast mode sends the same text to multiple sessions simultaneously. When activated, the next thing you type goes to all targeted sessions' PTY stdin at the same time.

### 38.2 Activation

- **Keyboard:** `Ctrl+b` toggles broadcast mode
- **Command bar:** `/send @all {message}` for a one-shot broadcast
- **Visual indicator:** When broadcast is active, a red "BROADCAST" badge appears in the top bar, and all target panes get a red border

### 38.3 Targeting

By default, broadcast sends to ALL sessions. But you can filter:

| Target | How to Activate | Use Case |
|--------|----------------|----------|
| All sessions | `Ctrl+b` (default) | "Run tests" to all agents |
| All idle sessions | Command bar: `/send @idle` | "Pick up next task" |
| All active sessions | Command bar: `/send @active` | "Stop what you're doing" |
| Specific sessions | Command bar: `/send @1,@3,@5` | Target a subset |

### 38.4 Behavior

When broadcast is active (via `Ctrl+b`):
1. User enters terminal mode on any pane (press Enter)
2. Visual: all target panes get red borders, badge reads "BROADCAST → 6 sessions"
3. Every keystroke is written to ALL target panes' PTY stdin simultaneously
4. Including Enter, Ctrl+C, Ctrl+D — everything
5. Press `Ctrl+b` again → exit broadcast mode, return to normal

**One-shot broadcast (via command bar):**
1. `/send @all please run the test suite`
2. The text "please run the test suite\n" is written to all PTYs
3. No mode change — stays in navigation mode

### 38.5 When Agents Are At Different Stages

This is the user's responsibility. Broadcasting "run tests" when Agent 1 is in a vim session and Agent 3 is at a shell prompt will produce different results. Synk does NOT try to be smart about this — it sends the bytes, period.

**Best practices (shown as a tooltip on first use):**
- Broadcast works best when all agents are at a shell prompt (idle)
- Use `/send @idle` to only target agents that aren't mid-task
- Use it for universal commands: "git status", "run tests", "exit"
- Avoid broadcasting to agents mid-conversation (they'll interpret your text as a prompt response)

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


