# TASK 1.5: Vim Navigation
> Phase 1 — Foundation | Single Session | Depends on: Task 1.4

## Status
Completed (2026-02-08).

## What to Build
Two-mode keyboard system: Navigation Mode (keys go to Synk) and Terminal Mode (keys go to PTY). Vim-style pane navigation with h/j/k/l. Visual focus indicators.

## Key Behaviors
- **Navigation Mode** (default): h/j/k/l moves between panes, number keys 1-9 jump to pane, Enter focuses selected pane → switches to Terminal Mode
- **Terminal Mode**: all keys go to PTY. Double-tap Escape (within 300ms) exits back to Navigation Mode. Single Escape waits 300ms then forwards to PTY.
- **Visual**: Navigation Mode = blue border on selected pane. Terminal Mode = green border.
- `Ctrl+b` is always intercepted by Synk (never forwarded to PTY) — reserved for broadcast

## Files to Create/Modify
```
src/lib/keybindings.ts                    (new — key event handler + mode state)
src/components/workspace/Workspace.tsx    (add keydown listener, pass mode state)
src/components/workspace/SessionPane.tsx  (border color based on mode + focus)
```

## Acceptance Test
Navigate with h/j/k/l — blue border moves between panes. Press Enter — border turns green, typing goes to terminal. Double-Escape — border turns blue, keys navigate again. Single Escape in vim inside terminal — forwards to vim correctly.

---
## SPEC REFERENCE (Read all of this carefully)
## 25. Vim Navigation ↔ Terminal Interaction

### 25.1 Two-Mode System

Synk has two input modes, inspired by Vim's normal/insert:

```
┌──────────────────────────────────────────────────────────────┐
│  NAVIGATION MODE (default)                                    │
│                                                               │
│  All keypresses → Synk's keybinding handler                  │
│  h/j/k/l moves between panes                                │
│  Other shortcuts work (n, x, t, r, /, etc.)                 │
│  Terminal panes are visible but NOT receiving input           │
│  Selected pane has a blue highlight border                    │
│                                                               │
│  Press Enter → enter TERMINAL MODE on selected pane          │
└──────────────────────────────────────────────────────────────┘
                              │
                        Enter │ ▲ Escape
                              ▼ │
┌──────────────────────────────────────────────────────────────┐
│  TERMINAL MODE (focused)                                      │
│                                                               │
│  All keypresses → PTY stdin of the focused terminal          │
│  User types directly into the agent/shell                    │
│  Other panes are dimmed slightly (visual focus cue)          │
│  Focused pane has a green border (vs blue in nav mode)       │
│                                                               │
│  Press Escape → return to NAVIGATION MODE                    │
│  UNLESS: terminal app has captured Escape (vim, nano, etc.)  │
└──────────────────────────────────────────────────────────────┘
```

### 25.2 The Escape Key Problem

Many terminal applications use Escape themselves (vim, less, nano, fzf, etc.). Synk needs to distinguish between "user wants to exit terminal mode" and "user pressed Escape for the terminal app."

**Solution: Double-Escape**

```
Single Escape press:
  → Start a 300ms timer
  → If another Escape within 300ms: EXIT terminal mode (return to nav)
  → If 300ms expires with no second Escape: FORWARD the Escape to the PTY
  → If any OTHER key within 300ms: FORWARD Escape + that key to the PTY

This means:
  - Quick double-tap Escape → Synk catches it, exits terminal mode
  - Single Escape → forwarded to vim/nano/etc. (after 300ms delay)
  - Escape then 'j' quickly → forwarded as Esc+j to terminal (vim command)
```

**Configurable escape sequence** in settings:
```json
{
  "terminal_exit_sequence": "double_escape",  // default
  // alternatives:
  // "ctrl_backslash"  → Ctrl+\ always exits (never forwarded)
  // "ctrl_shift_esc"  → Ctrl+Shift+Escape (never ambiguous)
}
```

### 25.3 Edge Cases

| Scenario | Behavior |
|----------|----------|
| User presses `j` in nav mode | Move to pane below. `j` NOT sent to any terminal. |
| User presses `j` in terminal mode | `j` sent to focused PTY (types 'j'). |
| User presses `Enter` on a pane in nav mode | Enter terminal mode on that pane. `Enter` NOT sent to PTY. |
| User presses `Enter` while already in terminal mode | `Enter` sent to PTY (normal terminal input). |
| User clicks a different pane while in terminal mode | Exit terminal mode on current pane → Enter terminal mode on clicked pane. |
| User clicks the focused pane's header bar | Exit terminal mode (return to nav). |
| `Ctrl+b` pressed in terminal mode | **Special case**: Synk intercepts this (broadcast toggle). NOT forwarded to PTY. |
| `Ctrl+b` pressed in nav mode | Broadcast mode toggled. |
| Agent is running (not waiting for input) in terminal mode | Keypresses still go to PTY. This lets user Ctrl+C to interrupt. |
| `/` pressed in nav mode | Opens command bar. Does NOT send `/` to any terminal. |
| `/` pressed in terminal mode | Sends `/` to PTY (normal input). |

### 25.4 Visual Focus Indicators

```
NAVIGATION MODE:
┌─ Agent 1 ──── claude ── main ── $0.12 ──────────── ●  ──┐
│  (blue border, 2px solid #58a6ff)                        │
│  Terminal content visible, normal opacity                 │
│                                                          │
│  $ _                                                     │
└──────────────────────────────────────────────────────────┘

TERMINAL MODE:
┌─ Agent 1 ──── claude ── main ── $0.12 ──────────── ●  ──┐
│  (green border, 2px solid #3fb950)                       │
│  Terminal content visible, full opacity                   │
│  Other panes dimmed to 70% opacity                       │
│                                                          │
│  $ typing here goes to the shell█                        │
└──────────────────────────────────────────────────────────┘

UNSELECTED PANE:
┌─ Agent 2 ──── gemini ── feat/api ── $0.08 ────── ●  ───┐
│  (gray border, 1px solid #3a3a4e)                        │
│  Terminal content visible, normal opacity                 │
│  (or 70% if another pane is in terminal mode)            │
│                                                          │
│  $ some output here                                      │
└──────────────────────────────────────────────────────────┘
```

### 25.5 Implementation: Key Event Flow

```typescript
// In the root Workspace component:
function handleKeyDown(e: KeyboardEvent) {
  if (mode === 'navigation') {
    // Check if it's a registered shortcut
    const action = keybindingMap[e.key];
    if (action) {
      e.preventDefault();
      executeAction(action);
      return;
    }
    // Unrecognized key in nav mode → ignore
  }
  
  if (mode === 'terminal') {
    // Check for intercepted keys (Ctrl+b, etc.)
    if (isInterceptedCombo(e)) {
      e.preventDefault();
      executeAction(interceptedActions[comboKey(e)]);
      return;
    }
    
    // Handle escape sequence detection
    if (e.key === 'Escape') {
      if (escapeTimer) {
        // Second escape within 300ms → exit terminal mode
        clearTimeout(escapeTimer);
        escapeTimer = null;
        setMode('navigation');
        return;
      }
      // First escape → start timer
      escapeTimer = setTimeout(() => {
        // Timer expired → forward escape to PTY
        forwardToPty(focusedPaneId, '\x1b');
        escapeTimer = null;
      }, 300);
      return;
    }
    
    // If escape timer is running and non-escape key pressed
    if (escapeTimer) {
      clearTimeout(escapeTimer);
      escapeTimer = null;
      // Forward escape + this key to PTY
      forwardToPty(focusedPaneId, '\x1b');
    }
    
    // Normal key → forward to PTY (xterm.js handles this natively)
    // Don't preventDefault — let xterm.js handle it
  }
}
```

---


## 12. Keyboard Navigation (Vim-Style)

| Key | Action |
|-----|--------|
| `h/j/k/l` | Navigate between session panes |
| `Enter` | Focus selected pane (enter insert mode) |
| `Escape` | Exit pane focus (back to navigation mode) |
| `1-9, 0` | Jump to session 1-10 directly |
| `/` | Open command bar |
| `n` | New session |
| `x` | Close current session |
| `t` | Toggle task queue panel |
| `r` | Toggle review queue panel |
| `g` | Toggle git activity panel |
| `c` | Toggle cost tracker panel |
| `m` | Toggle floating Mermaid planner |
| `d` | Open diff view for current session |
| `s` | Save session state |
| `?` | Show keyboard shortcut overlay |
| `Ctrl+b` | Broadcast mode (next prompt to all) |
| `Ctrl+p` | Open project switcher |
| `Ctrl+,` | Open settings |

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
