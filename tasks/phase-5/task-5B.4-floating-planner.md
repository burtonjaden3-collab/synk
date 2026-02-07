# TASK 5B.4: Floating Mermaid Planner (Frontend)
> Phase 5 — Brainstorm Wizard | Session B (Frontend) | Depends on: Task 5B.2

## What to Build
Toggleable floating panel for existing projects (not the wizard). Shows the system architecture diagram with live node status. Right-click nodes to link them to tasks.

## Features
- Toggle with `b` key or sidebar button
- Floating, draggable, resizable panel on top of workspace
- Shows system architecture Mermaid diagram from .synk/blueprint.json
- Nodes colored by status: gray (not started), blue (in progress), green (done), red (error)
- Right-click a node → "Link to task" → pick from task queue
- Node status updates in real-time as tasks progress

## Deliverables
1. `MermaidFloatingPanel.tsx` — floating draggable panel with Mermaid rendering
2. Live status overlay: color nodes based on linked task status
3. Right-click context menu on nodes: "Link to task", "View diff", "Unlink"
4. Reads from .synk/blueprint.json (bindings between nodeId and taskId)
5. Real-time updates via orchestrator events

## Files to Create/Modify
```
src/components/planner/MermaidFloatingPanel.tsx (new)
src/lib/keybindings.ts                         (add 'b' key handler)
```

## Acceptance Test
Press `b` → floating panel appears with architecture diagram. Nodes show gray. Link a node to a task → node turns blue when task is in progress. Task completes → node turns green. Drag/resize panel.

---
## SPEC REFERENCE (Read all of this carefully)
## 19. Mermaid Blueprint Generation — Prompt Templates

### 19.1 The Five Diagram Types

Each diagram type has a dedicated prompt template. The AI receives the full `ProjectBlueprint` JSON as context along with the template.

**Template 1: System Architecture**
```
Generate a Mermaid flowchart showing the system architecture.

REQUIREMENTS:
- Use `flowchart TD` (top-down layout)
- Group related components with `subgraph` blocks
  (e.g., "Frontend", "Backend", "Data Layer", "External Services")
- Show data flow direction with labeled arrows
- Include: UI components, API layer, business logic, databases,
  caches, message queues, external APIs, auth services
- Use icons in node labels where helpful: 🖥️ 🔌 🗄️ 💾 🔐

STYLE RULES:
- Node IDs: lowercase-kebab (e.g., auth-service)
- Node labels: Title Case with brief description
- Arrow labels: verb phrase (e.g., "queries", "authenticates via")
- Max 20 nodes (combine minor components)

RESPOND WITH ONLY VALID MERMAID SYNTAX.
```

**Template 2: File/Folder Structure**
```
Generate a Mermaid graph showing the project directory structure as a tree.

REQUIREMENTS:
- Use `graph TD` layout
- Root node = project name
- Show directories as rounded rectangles, files as plain rectangles
- Include: src/, config files, package manifests, test directories,
  public/static assets, CI/CD files
- Annotate key files with their purpose in parentheses
  e.g., "main.rs (entry point)"
- Depth: max 3 levels deep. Group deeper content as "..."
- Style directories differently: use `:::dir` class

RESPOND WITH ONLY VALID MERMAID SYNTAX.
```

**Template 3: Database Schema (ER Diagram)**
```
Generate a Mermaid ER diagram showing the database schema.

REQUIREMENTS:
- Use `erDiagram` syntax
- Include all entities identified in the project spec
- Show relationships with proper cardinality:
  ||--o{ (one to many), ||--|| (one to one), }o--o{ (many to many)
- Each entity must include: primary key, foreign keys, and 3-7
  most important fields with data types
- Use standard types: string, int, uuid, datetime, boolean, text, float
- Add relationship labels (e.g., "places", "belongs to", "has many")

RESPOND WITH ONLY VALID MERMAID SYNTAX.
```

**Template 4: API Routes**
```
Generate a Mermaid flowchart showing the API route structure.

REQUIREMENTS:
- Use `flowchart LR` (left-to-right layout)
- Group routes by resource with `subgraph` blocks
  (e.g., "/auth", "/users", "/products")
- Each node = one endpoint: "METHOD /path"
  e.g., "POST /auth/login"
- Color-code by HTTP method:
  - GET: green (:::get)
  - POST: blue (:::post)
  - PUT/PATCH: orange (:::put)
  - DELETE: red (:::delete)
- Show middleware/auth requirements as diamond decision nodes
- Include request/response summary on hover (title attribute)

RESPOND WITH ONLY VALID MERMAID SYNTAX.
```

**Template 5: Deployment Architecture**
```
Generate a Mermaid flowchart showing the deployment and infrastructure.

REQUIREMENTS:
- Use `flowchart TD` layout
- Show: developer machine, CI/CD pipeline, staging, production
- Include: version control (GitHub/GitLab), build steps, testing,
  container registry, hosting platform, CDN, DNS, monitoring
- Show deployment flow with numbered arrows (1. push, 2. build, etc.)
- Include environment variables / secrets management
- Show scaling strategy if applicable (load balancer, replicas)

RESPOND WITH ONLY VALID MERMAID SYNTAX.
```

### 19.2 Validation & Error Recovery

After receiving Mermaid source from the AI:
1. **Syntax validation**: Run through `mermaid.parse()` on the frontend
2. **If invalid**: Send back to AI with the error message: `"The Mermaid syntax had an error: {error}. Fix it and return the corrected version."`
3. **Max 3 retry attempts** before showing the raw source in the editor for manual fixing
4. **Fallback**: If AI consistently fails on a diagram type, show a template skeleton the user can fill in manually

### 19.3 Live Node Status Updates (Existing Projects)

Once a project is active in the workspace, the Mermaid planner becomes a **live dashboard**. Each node in the architecture diagram can be linked to a task:

```typescript
interface MermaidNodeBinding {
  nodeId: string;          // "auth-service" from the diagram
  taskId: string | null;   // linked task in the task queue
  status: 'not_started' | 'in_progress' | 'done' | 'failed';
}
```

The floating Mermaid panel applies CSS classes to nodes based on status:
- `not_started`: default styling (gray border)
- `in_progress`: pulsing blue border + 🔵 badge
- `done`: green border + ✅ badge
- `failed`: red border + ❌ badge

Binding is manual: user right-clicks a node → "Link to task" → picks from task queue. This keeps it simple and avoids brittle auto-matching.

### 19.4 Blueprint as Agent Context (Critical Requirement)

When an agent is dispatched to a task, Synk **always injects the relevant Mermaid blueprint** into the agent's context so the agent understands where its work fits in the bigger picture. This happens automatically — the user doesn't need to do anything.

**Injection methods (by agent type):**

| Agent | How Blueprint is Provided |
|-------|--------------------------|
| Claude Code | Written into the project's `CLAUDE.md` file under a `## Project Blueprint` section. Claude Code reads this automatically. |
| Gemini CLI | Prepended to the task prompt as a context block. |
| Codex | Included in the system prompt or project context file. |
| Plain Terminal | Not applicable (no AI to consume it). |

**What's included in CLAUDE.md (always present):**
- The system architecture diagram ONLY (gives the big picture without bloating the file)

**What's injected per-task via prompt (not in CLAUDE.md):**
- The specific diagram layer most relevant to the task (e.g., database schema if the task is "build the user model")
- A note highlighting which node(s) in the architecture diagram this task corresponds to
- Current status of related nodes (so the agent knows what's already done vs. pending)

This split keeps CLAUDE.md under 200 lines while still giving each agent targeted context for its specific task.

**When blueprints update:** If the user edits a diagram while agents are working, Synk updates the `CLAUDE.md` / context file. Agents pick up changes on their next prompt cycle.

This ensures every agent works with architectural awareness, not in isolation. The blueprint is the single source of truth for how the project fits together.

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


