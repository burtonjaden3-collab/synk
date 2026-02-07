# TASK 6B.2: Notification System (Frontend)
> Phase 6 — Polish | Session B | Depends on: Phase 5

## What to Build
Toast notification system + notification history log. Shows events like task completion, agent errors, merge conflicts, review ready.

## Notification Types
| Event | Default On | Level | Auto-dismiss |
|-------|-----------|-------|-------------|
| Task completed | ✅ | Info | Yes (5s) |
| Agent error/crash | ✅ | Error | ❌ NO — stays until dismissed |
| Merge conflict | ✅ | Warning | Yes (5s) |
| Review ready | ✅ | Info | Yes (5s) |
| Cost threshold | ⬜ | Warning | Yes (5s) |
| All tasks done | ✅ | Success | Yes (5s) |

## Toast Behavior
- Position: top-right (configurable)
- Stack vertically, newest on top, max 4 visible
- Hover → pause dismiss timer
- Click body → navigate to relevant view
- Action buttons: "Re-dispatch", "Open Review", "View Logs"
- **Error toasts never auto-dismiss** — must click × or action

## Notification History
- Bell icon in top bar with unread badge count
- Click → scrollable history log of all past notifications
- "Clear All" button

## Deliverables
1. `Notifications.tsx` — toast container: renders/dismisses/stacks toasts
2. `NotificationHistory.tsx` — bell icon + dropdown history panel
3. All notification types with correct icons, levels, and behavior
4. Per-type toggle in Settings
5. Click-to-navigate: clicking a review toast opens review panel

## Files to Create/Modify
```
src/components/shared/Notifications.tsx       (new)
src/components/shared/NotificationHistory.tsx (new)
src/lib/store.ts                              (notification state)
```

## Acceptance Test
Trigger task completion → toast appears top-right, dismisses after 5s. Trigger agent error → red toast stays until clicked. Bell icon shows unread count. Click bell → history shows all past notifications.

---
## SPEC REFERENCE (Read all of this carefully)
## 35. Notification System

### 35.1 Notification Types

| Event | Default | Level | Message Example |
|-------|---------|-------|-----------------|
| Task completed | ✅ On | Info | "✅ 'Build auth module' completed by Agent 2" |
| Agent error/crash | ✅ On | Error | "❌ Agent 3 crashed — task 'Build API' can be re-dispatched" |
| Merge conflict | ✅ On | Warning | "⚠️ Merge conflict in feat/auth → main (3 files). Delegating to agent." |
| Review ready | ✅ On | Info | "📋 Agent 1 finished 'User model' — ready for review" |
| Cost threshold reached | ⬜ Off | Warning | "💰 Session 2 has exceeded $5.00" |
| All tasks done | ✅ On | Success | "🎉 All 6 tasks completed! Total cost: $3.42" |
| Gastown version mismatch | ✅ On | Warning | "⚠️ Gastown v0.4.0 detected. Synk is pinned to v0.3.x." |
| Pool exhausted | ✅ On | Warning | "⚠️ Max sessions reached (12). New tasks queued." |
| Agent dispatched | ⬜ Off | Info | "🚀 'Build dashboard' dispatched to Agent 4" |
| Session restored | ✅ On | Info | "♻️ Session restored: 4 panes, 2 tasks queued" |

### 35.2 Display Method: Toast Notifications

Notifications appear as **toast popups** in the top-right corner of the screen (configurable position). They stack vertically, newest on top, and auto-dismiss after 5 seconds (configurable).

```
┌──────────────────────────────────────────────────────────────────┐
│                                                        ┌───────┐│
│                                                        │ ✅ ×  ││
│                                                        │ Build ││
│                                                        │ auth  ││
│                                                        │ done  ││
│                SESSION GRID                             └───────┘│
│                                                        ┌───────┐│
│                                                        │ 📋 ×  ││
│                                                        │ Ready ││
│                                                        │ for   ││
│                                                        │review ││
│                                                        └───────┘│
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 35.3 Toast Anatomy

```
┌──────────────────────────────┐
│ {icon} {title}           [×] │  ← icon, title, dismiss button
│ {body message}               │  ← description text
│ [Action Button]              │  ← optional CTA (e.g., "Open Review")
└──────────────────────────────┘
```

**Behavior:**
- Hover over toast → pause auto-dismiss timer
- Click toast body → navigate to relevant view (e.g., clicking a review notification opens the review panel)
- Click `×` → dismiss immediately
- Click action button → execute action + dismiss
- Max 4 toasts visible at once; overflow queues

### 35.4 Error-Specific Behavior

Errors (red toasts) do NOT auto-dismiss — they stay until the user manually closes them or clicks an action. This ensures critical errors aren't missed:

```
┌──────────────────────────────┐
│ ❌ Agent 3 Crashed           │
│ Task 'Build API' stopped     │
│ unexpectedly.                │
│ [Re-dispatch]  [View Logs]   │
└──────────────────────────────┘
```

### 35.5 Notification Log

All notifications are also logged to a scrollable **Notification History** accessible from the top bar (bell icon with unread badge). This catches anything the user might have missed:

```
Notification History (click bell icon in top bar):
┌─────────────────────────────────────────────────┐
│ 🔔 Notification History              [Clear All]│
│                                                  │
│ 10:42 PM  ✅ 'Build auth module' completed       │
│ 10:38 PM  📋 Agent 1 ready for review            │
│ 10:35 PM  🚀 'Build auth' dispatched to Agent 2  │
│ 10:30 PM  ❌ Agent 3 crashed (re-dispatched)      │
│ 10:15 PM  ♻️  Session restored: 4 panes           │
└─────────────────────────────────────────────────┘
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


