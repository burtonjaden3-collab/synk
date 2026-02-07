# TASK 6B.1: Cost Tracking (Backend + Frontend)
> Phase 6 — Polish | Session B | Depends on: Phase 5

## What to Build
Track AI agent costs per session. Parse agent output for cost data. Show in bottom drawer Cost Tracker panel + per-pane header.

## 3-Layer Cost Detection
1. **MCP status** (future) — placeholder for when agents report costs via MCP
2. **Output parsing** — regex patterns on PTY stdout per agent type
3. **Heuristic estimation** — estimate from terminal I/O character count when no direct data

## Regex Patterns
```
Claude Code: /Total cost:\s+\$([0-9.]+)/
             /Token usage:.*?(\d+)\s+input.*?(\d+)\s+output/
Gemini CLI:  /Cost:\s+\$([0-9.]+)/
Codex:       /Usage:.*?\$([0-9.]+)/
```

## Confidence Indicators
- ✅ Exact — from MCP or explicit cost output
- 📊 Parsed — from regex pattern match
- ⚠️ Estimated — heuristic guess

## Deliverables
1. `cost_tracker.rs` — per-session cost accumulator, output parser with regex per agent
2. `CostTracker.tsx` — drawer panel: session-by-session cost breakdown, total, bar chart
3. Per-pane cost display in session header: "$1.23 📊"
4. User-editable pricing table in ~/.config/synk/pricing.json
5. Confidence indicator next to every cost figure

## Files to Create/Modify
```
src-tauri/src/core/cost_tracker.rs     (new)
src/components/drawer/CostTracker.tsx  (new)
src/components/workspace/SessionPane.tsx (add cost to header)
```

## Acceptance Test
Run Claude Code session → cost appears in pane header as tokens are used. Drawer shows breakdown per session. Change pricing in pricing.json → estimates update.

---
## SPEC REFERENCE (Read all of this carefully)
## 23. Cost Tracking — Parser Specifications

### 23.1 Layered Detection Strategy

```
Layer 1: MCP Status Reporting (most accurate)
  → If agent supports MCP cost reporting, use it directly
  → Structured JSON with exact token counts and cost
  → Currently: no agents support this (future-proofing)

Layer 2: Output Parsing (reliable for known agents)
  → Parse agent's terminal output for cost/token lines
  → Regex patterns per agent type
  → This is what we build for Phase 1

Layer 3: Heuristic Estimation (last resort)
  → Count approximate tokens in/out from terminal I/O
  → Apply model pricing rates
  → Very rough estimate, clearly labeled as such
```

### 23.2 Agent Output Patterns

**Claude Code** — outputs cost summary at the end of each task and on exit:

```
# Per-task summary (appears after each completed prompt):
Pattern: /Total tokens: ([\d,]+) input, ([\d,]+) output/
Pattern: /Total cost: \$([\d.]+)/
Pattern: /Session cost: \$([\d.]+)/

# Session exit summary:
Pattern: /── Session Summary ──/
Pattern: /Input tokens:\s+([\d,]+)/
Pattern: /Output tokens:\s+([\d,]+)/
Pattern: /Total cost:\s+\$([\d.]+)/
Pattern: /Duration:\s+(\d+)m\s*(\d+)s/

# Model detection (for pricing):
Pattern: /Using model:\s+(\S+)/
Pattern: /Model:\s+(\S+)/
```

Example Claude Code output:
```
── Session Summary ──
Input tokens:   45,231
Output tokens:  12,847
Cache creation:  8,102
Cache read:     31,205
Total cost:     $0.47
Duration:       3m 21s
```

**Gemini CLI** — outputs token usage inline:

```
# Per-response:
Pattern: /\[(\d+) input tokens, (\d+) output tokens\]/
Pattern: /Tokens used: (\d+)/

# Session summary (on exit):
Pattern: /Total tokens used: ([\d,]+)/
Pattern: /Estimated cost: \$([\d.]+)/
```

**OpenAI Codex CLI** — outputs usage stats:

```
# Per-response:
Pattern: /Usage: (\d+) prompt \+ (\d+) completion = (\d+) total tokens/
Pattern: /Cost: \$([\d.]+)/

# Session:
Pattern: /Session total: ([\d,]+) tokens, \$([\d.]+)/
```

### 23.3 Parser Implementation

```rust
pub struct CostParser {
    agent_type: AgentType,
    patterns: Vec<CostPattern>,
    cumulative: CostAccumulator,
}

pub struct CostPattern {
    regex: Regex,
    extractor: fn(&regex::Captures) -> CostDelta,
}

pub struct CostDelta {
    input_tokens: Option<usize>,
    output_tokens: Option<usize>,
    cost_dollars: Option<f64>,
    model: Option<String>,
}

pub struct CostAccumulator {
    pub total_input_tokens: usize,
    pub total_output_tokens: usize,
    pub total_cost: f64,
    pub model: Option<String>,
    pub last_updated: Instant,
    pub data_source: CostSource,
}

pub enum CostSource {
    MCP,             // most accurate
    OutputParsed,    // reliable
    Heuristic,       // rough estimate, flagged in UI
}
```

The parser runs on every chunk of PTY output. Each line is checked against all patterns for the active agent type. When a match is found, the `CostAccumulator` is updated and a `cost:updated` Tauri event is emitted to the frontend.

### 23.4 Cost Display

The UI shows cost data with a confidence indicator:

| Source | Display | Icon |
|--------|---------|------|
| MCP | "$0.47" (exact) | ✅ |
| Output Parsed | "$0.47" (parsed) | 📊 |
| Heuristic | "~$0.50" (estimated) | ⚠️ |
| No data | "—" | — |

### 23.5 Model Pricing Table

Stored in `~/.config/synk/pricing.json` — user-editable:

```json
{
  "anthropic": {
    "claude-opus-4-6": { "input": 15.0, "output": 75.0 },
    "claude-sonnet-4-5": { "input": 3.0, "output": 15.0 },
    "claude-haiku-4-5": { "input": 0.80, "output": 4.0 }
  },
  "openai": {
    "gpt-4o": { "input": 2.50, "output": 10.0 },
    "o3-mini": { "input": 1.10, "output": 4.40 }
  },
  "google": {
    "gemini-2.0-flash": { "input": 0.10, "output": 0.40 },
    "gemini-2.5-pro": { "input": 1.25, "output": 10.0 }
  }
}
```

Prices are per million tokens. Synk ships with defaults and prompts for updates when new models are detected.

---


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


