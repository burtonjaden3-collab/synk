# TASK 5B.3: Export Panel + Convoy Export (Frontend)
> Phase 5 — Brainstorm Wizard | Session B (Frontend) | Depends on: Task 5B.2

## What to Build
Export panel with all export options. Convert blueprints to Gastown convoys. Scaffold project directories. Generate CLAUDE.md.

## Export Options
1. **Scaffold directory** — create project folder with boilerplate files based on tech stack
2. **Export to CLAUDE.md** — generate the context file (calls backend from Task 5A.2)
3. **Export to Gastown Convoys** — convert diagram nodes to beads + convoys (if Gastown mode)
4. **Export to local task list** — create tasks in Manual mode task queue
5. **Copy as markdown** — copy all diagrams + extracted data as markdown to clipboard

## Gastown Convoy Export Logic
1. AI generates task manifest from architecture diagram (which nodes are buildable)
2. For each task: `bd create` → get bead ID
3. Group by subgraph → `gt convoy create`
4. Set dependencies → `bd link --depends-on`
5. Store nodeId → beadId mapping in .synk/blueprint.json

## Deliverables
1. `ExportPanel.tsx` — export options with checkboxes + "Export" button
2. Scaffold: create directories + placeholder files based on tech stack
3. Convoy export: call backend Gastown CLI commands to create beads/convoys
4. Task list export: create tasks in local .synk/tasks.json
5. Success/failure feedback for each export action

## Files to Create/Modify
```
src/components/wizard/ExportPanel.tsx (new)
```

## Acceptance Test
Select "Scaffold + CLAUDE.md + Gastown Convoys". Click Export. → Directory created with files. → CLAUDE.md generated. → Beads visible in Gastown. All in visible terminal panes.

---
## SPEC REFERENCE (Read all of this carefully)
## 36. Blueprint → Gastown Convoy Export

### 36.1 The Mapping Problem

Mermaid diagrams are visual — nodes and arrows. Gastown tasks are structured — beads with titles, descriptions, and dependencies. The export needs to bridge these two worlds.

### 36.2 How Nodes Map to Beads

When the user clicks "Export to Gastown Convoys" in the brainstorm wizard, Synk processes the **System Architecture** diagram (the primary one — most directly maps to work items):

**Step 1: Extract actionable nodes**

Not every Mermaid node becomes a task. Synk filters:
- ✅ Nodes representing components to build (e.g., "Auth Service", "User Dashboard", "REST API")
- ❌ External services (e.g., "Stripe API", "PostgreSQL") — these are dependencies, not tasks
- ❌ Infrastructure nodes (e.g., "Load Balancer", "CDN") — deployment phase, not coding
- ❌ Grouping nodes (subgraph labels)

**How it decides:** The AI that generated the diagram also generates a task manifest. During blueprint generation, Synk sends a follow-up prompt:

```
Given this architecture diagram, generate a task list for building this project.
For each buildable component, output a JSON object with:
- node_id: the Mermaid node ID this maps to
- title: short task title (imperative verb: "Build...", "Create...", "Set up...")
- description: 2-3 sentences describing what to build
- dependencies: array of node_ids that must be completed first
- estimated_complexity: "small" | "medium" | "large"
- suggested_branch: branch name for this work

Output ONLY a JSON array. No explanation.
```

**Step 2: Create beads and convoys**

```
For each task in the manifest:
  1. bd create --title "{title}" --description "{description}" --prefix {rig}
     → returns bead ID (e.g., gt-abc12)
  2. Store mapping: { nodeId → beadId }

Group related tasks into convoys:
  - Tasks within the same subgraph → same convoy
  - If no subgraphs: one convoy for the whole export
  
  gt convoy create "{subgraph name}" {bead-id-1} {bead-id-2} ...
```

**Step 3: Set dependencies**

```
For each task with dependencies:
  bd link {bead-id} --depends-on {dependency-bead-id}
```

**Step 4: Update blueprint bindings**

Store the nodeId → beadId mapping in `.synk/blueprint.json` so the Mermaid planner can show live status:

```json
{
  "bindings": [
    { "nodeId": "auth-service", "taskId": "gt-abc12", "beadId": "gt-abc12" },
    { "nodeId": "user-dashboard", "taskId": "gt-def34", "beadId": "gt-def34" }
  ]
}
```

### 36.3 Example

Architecture diagram has these nodes:
```
subgraph Backend
  auth-service[Auth Service]
  api-gateway[API Gateway]
  data-layer[Data Layer]
end
subgraph Frontend
  dashboard[Dashboard UI]
  login-page[Login Page]
end
```

Exported as:
```
Convoy: "Backend"
  ├── Bead: "Build Auth Service"      (gt-abc12) depends on: data-layer
  ├── Bead: "Build API Gateway"       (gt-def34) depends on: auth-service
  └── Bead: "Build Data Layer"        (gt-ghi56) depends on: nothing

Convoy: "Frontend"
  ├── Bead: "Build Dashboard UI"      (gt-jkl78) depends on: api-gateway
  └── Bead: "Build Login Page"        (gt-mno90) depends on: auth-service
```

Dispatch order (respecting dependencies):
1. Data Layer (no deps)
2. Auth Service (after Data Layer)
3. API Gateway (after Auth Service)
4. Login Page (after Auth Service)
5. Dashboard UI (after API Gateway)

---


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


## 30. CLAUDE.md Generation

### 30.1 What is CLAUDE.md?

`CLAUDE.md` is a project context file that Claude Code reads automatically when it starts a session. It tells the AI agent everything it needs to know about the project — architecture, conventions, what's been done, what's in progress. Synk generates and maintains this file.

### 30.2 Generated File Structure

```markdown
# Project: {project_name}

## Overview
{project description from brainstorm wizard or user-provided}

## Tech Stack
{tech stack list from blueprint or config}

## Project Blueprint

### System Architecture
```mermaid
{architecture diagram mermaid source}
```

### File Structure
```mermaid
{file structure diagram mermaid source}
```

### Database Schema
```mermaid
{ER diagram mermaid source}
```

### API Routes
```mermaid
{API routes diagram mermaid source}
```

### Deployment
```mermaid
{deployment diagram mermaid source}
```

## Current Status

### Completed
- ✅ {task title} ({branch name}, merged)
- ✅ {task title} ({branch name}, merged)

### In Progress
- 🔵 {task title} — being worked on by {agent type} on branch `{branch}`
- 🔵 {task title} — being worked on by {agent type} on branch `{branch}`

### Queued
- ⬜ {task title}
- ⬜ {task title}

## Conventions
- Branch naming: `feat/{task-slug}`, `fix/{task-slug}`
- Commit style: conventional commits (feat:, fix:, chore:, etc.)
- Test files: colocated with source in `__tests__/` directories
- {any user-added conventions from .synk/config.json}

## Important Notes
- This file is auto-generated by Synk. Manual edits to the sections above
  will be overwritten. Add custom notes below the line.

---

{user's custom notes preserved here — Synk never overwrites below this line}
```

### 30.3 Size Constraints (Critical)

CLAUDE.md must stay concise to preserve agent context window for actual work. A bloated context file makes agents slower and less effective.

**Hard limits:**
- **Target size: under 200 lines / ~4KB**
- **Absolute max: 300 lines** — if file exceeds this, Synk auto-trims (see trimming rules below)

**Conciseness rules:**

| Section | Rule |
|---------|------|
| Overview | Max 2 sentences |
| Tech Stack | Bullet list, no descriptions — just names |
| Blueprint diagrams | Include ONLY the system architecture diagram (the most useful one). Other 4 diagrams stored in `.synk/blueprint.json` only — agents can request them if needed. |
| Current Status | Max 5 completed tasks shown (most recent). Older ones just show a count: "...and 12 more completed tasks" |
| In Progress | All shown (these are actively relevant) |
| Queued | Max 5 shown. Rest summarized: "...and 8 more queued" |
| Conventions | Max 5 bullet points |

**Trimming priority (when file exceeds 300 lines):**
1. First: reduce Completed list to 3 items + count
2. Then: reduce Queued list to 3 items + count  
3. Then: simplify architecture diagram (remove subgraph details)
4. Never trim: In Progress items, Conventions, user notes below separator

**Why only one diagram:** The system architecture diagram gives agents 80% of the context value. Including all 5 diagrams would easily push CLAUDE.md past 500 lines. The other diagrams are available on demand — an agent can read `.synk/blueprint.json` if it needs the DB schema or API routes for a specific task.

**Per-task context injection:** When dispatching a task, Synk appends a small task-specific block to the agent's prompt (NOT to CLAUDE.md) with the relevant diagram for that task:

```
Your current task: "Build user authentication"
Relevant schema for this task:
```mermaid
{ER diagram — only the relevant entities}
`` `
```

This keeps CLAUDE.md lean while still giving each agent the specific context it needs.

### 30.4 When CLAUDE.md Updates

| Trigger | What Updates |
|---------|-------------|
| Blueprint generated/edited | Architecture, file structure, DB, API, deployment sections |
| Task completed and merged | Moves from "In Progress" → "Completed" |
| New task dispatched | Added to "In Progress" with agent and branch info |
| Task added to queue | Added to "Queued" |
| User edits conventions | Conventions section updates |
| Agent dispatched to new session | Fresh CLAUDE.md write so agent has latest state |

### 30.5 The Separator Line

The `---` line near the bottom is critical. Everything above it is auto-managed by Synk. Everything below it is user-owned and never touched. This lets users add custom notes, coding standards, or context without worrying about Synk overwriting it.

**On first generation:** Synk checks if `CLAUDE.md` already exists. If it does:
1. Read the existing file
2. Look for the `---` separator
3. Preserve everything below the separator
4. Replace everything above with Synk's generated content
5. If no separator exists, append Synk's content above a new separator and move existing content below it

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


