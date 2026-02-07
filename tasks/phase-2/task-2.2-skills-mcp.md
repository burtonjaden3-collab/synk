# TASK 2.2: Skills & MCP Discovery
> Phase 2 — Sidebar & Config | Single Session | Depends on: Task 2.1

## What to Build
Auto-detect installed Claude Code skills and MCP servers by reading config files on disk. Display them in the sidebar with toggle switches.

## Discovery Sources
**Skills:** ~/.claude/settings.json → skills.installed[], fallback to scanning ~/.claude/skills/ directory
**MCP Servers:** ~/.claude/mcp.json (global) + {project}/.mcp.json (project-level)

## Deliverables
1. `skills_discovery.rs` — read skill configs, return list with name/path/enabled/description
2. `mcp_discovery.rs` — read MCP configs, detect running servers via pgrep
3. `SkillsBrowser.tsx` — sidebar section with skill list + toggle switches
4. `McpManager.tsx` — sidebar section with server list + status indicators (🟢/🔴) + toggles
5. Refresh on app launch + project switch + manual refresh button

## Files to Create/Modify
```
src-tauri/src/core/skills_discovery.rs  (new)
src-tauri/src/core/mcp_discovery.rs     (new)
src-tauri/src/commands/skills.rs        (new)
src-tauri/src/commands/mcp.rs           (new)
src/components/sidebar/SkillsBrowser.tsx (new)
src/components/sidebar/McpManager.tsx   (new)
```

## Acceptance Test
If ~/.claude/skills/ has skills → they appear in sidebar. Toggle a skill on/off → state persists. MCP servers from mcp.json appear with status. Refresh button re-scans.

---
## SPEC REFERENCE (Read all of this carefully)
## 39. Skills & MCP File Parsing

### 39.1 Skills Discovery

Synk reads Claude Code's skill configuration to find installed skills.

**Source 1: `~/.claude/settings.json`**

```json
{
  "permissions": { ... },
  "skills": {
    "installed": [
      {
        "name": "frontend-design",
        "path": "/home/jaden/.claude/skills/frontend-design/",
        "enabled": true,
        "description": "Create production-grade frontend interfaces"
      },
      {
        "name": "docx-creator",
        "path": "/home/jaden/.claude/skills/docx-creator/",
        "enabled": true,
        "description": "Generate Word documents"
      }
    ]
  }
}
```

**Fields Synk reads:**
- `name` → display name in Skills Browser
- `path` → used to verify skill still exists on disk
- `enabled` → default toggle state
- `description` → shown as subtitle in Skills Browser

**Source 2: Project `CLAUDE.md` files**

Synk scans for skill references in `CLAUDE.md`:
```markdown
## Skills
- Use the frontend-design skill for UI work
- Use the api-scaffold skill for backend routes
```

These are displayed as "project-recommended skills" in the Skills Browser.

**Source 3: `~/.claude/skills/` directory scan**

If `settings.json` is missing or incomplete, Synk falls back to scanning the skills directory:
```bash
ls ~/.claude/skills/
```
Each subdirectory is treated as a skill. Synk reads `SKILL.md` inside each for the description.

### 39.2 MCP Server Discovery

**Source 1: `~/.claude/mcp.json` (global MCP config)**

```json
{
  "servers": {
    "filesystem": {
      "command": "mcp-server-filesystem",
      "args": ["/home/jaden/projects"],
      "env": {},
      "enabled": true
    },
    "github": {
      "command": "mcp-server-github",
      "args": [],
      "env": {
        "GITHUB_TOKEN": "ghp_..."
      },
      "enabled": true
    },
    "postgres": {
      "command": "mcp-server-postgres",
      "args": ["postgresql://localhost:5432/mydb"],
      "env": {},
      "enabled": false
    }
  }
}
```

**Fields Synk reads per server:**
- Key name (e.g., "filesystem") → display name in MCP Manager
- `command` → the binary to run
- `args` → arguments to pass
- `env` → environment variables
- `enabled` → default toggle state

**Source 2: Project-level `.mcp.json`**

Same schema as above but scoped to a project. Found in the project root directory. Project-level servers override global ones with the same name.

**Source 3: Running process detection**

Synk runs `pgrep -a mcp-server` to find currently running MCP servers. These are shown with a "running" status badge even if they aren't in any config file.

### 39.3 What Synk Does With This Data

**Skills:**
- Lists them in the sidebar Skills Browser with toggle switches
- When a skill is toggled on/off, Synk updates the agent's skill configuration
- For Claude Code: modifies the `--skills` flag or updates `CLAUDE.md` to reference/remove the skill
- For other agents: skills are informational only (Gemini/Codex don't use Claude skills)

**MCP Servers:**
- Lists them in the sidebar MCP Manager with toggle switches and status indicators
- Status: 🟢 Connected (process running + responding), 🟡 Starting, 🔴 Disconnected, ⚪ Disabled
- Toggle on → Synk starts the MCP server process using the configured command + args + env
- Toggle off → Synk sends SIGTERM to the server process
- Per-session MCP: user can override which MCP servers a specific session uses

### 39.4 Refresh Behavior

Skills and MCP discovery runs:
1. On app launch
2. On project switch
3. When user clicks "Refresh" button in Skills Browser or MCP Manager
4. NOT continuously (file watching these configs is overkill)

---


## 10. Skills & MCP Discovery

### Auto-Detection
The app scans for installed skills and MCP servers on startup:

**Skills:**
- Reads `~/.claude/skills/` directory
- Reads `CLAUDE.md` files in project directories
- Parses `.claude/settings.json` for configured skills
- Presents as toggleable list in sidebar

**MCP Servers:**
- Reads `~/.claude/mcp.json` or `.mcp.json` in project root
- Detects running MCP processes
- Shows connection status per server
- Parses MCP server capabilities (available tools)

### Manual Override
- "Add Skill" button: name, path/URL, description
- "Add MCP Server" button: name, command, args, env
- "Remove" / "Disable" toggles
- Per-session skill/MCP assignment (override global defaults)

---


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


