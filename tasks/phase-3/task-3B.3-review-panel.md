# TASK 3B.3: Review Panel + Diff Viewer (Frontend)
> Phase 3 — Git Integration | Session B (Frontend) | Depends on: Task 3B.1

## What to Build
PR-style review panel: file list showing changed files, side-by-side diff viewer with syntax highlighting, line comments, approve/reject/request changes buttons.

## Review Flow
1. Agent completes task → status changes to "Review Ready"
2. Review appears in Review Queue tab
3. Click to open → see file list + diffs
4. Add line comments
5. Approve → triggers merge. Reject → task re-queued with feedback.

## Deliverables
1. `ReviewPanel.tsx` — main review view: file list left, diff right
2. `DiffViewer.tsx` — side-by-side or unified diff with line numbers + syntax highlighting
3. `CommentThread.tsx` — line-level comments (click gutter to add)
4. `ReviewQueue.tsx` — list of pending reviews in drawer tab
5. Action buttons: ✅ Approve, ❌ Reject, 🔄 Request Changes
6. Connects to review Tauri commands from the backend

## Files to Create/Modify
```
src/components/review/ReviewPanel.tsx    (new)
src/components/review/DiffViewer.tsx     (new)
src/components/review/CommentThread.tsx  (new)
src/components/drawer/ReviewQueue.tsx    (new)
```

## Acceptance Test
Review item appears in queue. Click → file list shown. Click file → diff renders with line numbers. Click gutter → add comment. Click Approve → triggers merge command.

---
## SPEC REFERENCE (Read all of this carefully)
## 20. PR Review Panel — Data Model & State Machine

### 20.1 Data Model

```typescript
interface ReviewItem {
  id: string;                          // uuid
  taskId: string;                      // linked task
  sessionId: number;                   // which pane produced this work
  branch: string;                      // e.g., "feat/auth-system"
  baseBranch: string;                  // e.g., "main"
  status: ReviewStatus;
  createdAt: string;                   // ISO datetime
  updatedAt: string;

  // Git stats
  filesChanged: number;
  additions: number;
  deletions: number;
  files: FileDiff[];

  // Review data
  comments: ReviewComment[];
  reviewDecision: ReviewDecision | null;
  mergeStrategy: MergeStrategy | null;
}

interface FileDiff {
  path: string;                        // relative file path
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;                    // if renamed
  hunks: DiffHunk[];
}

interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

interface DiffLine {
  type: 'context' | 'addition' | 'deletion';
  lineNumber: number;                  // line number in the new file
  content: string;
}

interface ReviewComment {
  id: string;
  filePath: string;
  lineNumber: number;                  // anchored to specific line
  body: string;
  author: 'user' | 'agent';           // who wrote the comment
  createdAt: string;
  resolved: boolean;
}

type ReviewDecision = 'approved' | 'rejected' | 'changes_requested';
type MergeStrategy = 'merge' | 'squash' | 'rebase';
```

### 20.2 Review State Machine

```
                    ┌──────────────┐
                    │   PENDING    │ ← Agent completes task, branch pushed
                    └──────┬───────┘
                           │ User opens review
                           ▼
                    ┌──────────────┐
                    │ IN_REVIEW    │ ← User viewing diffs, adding comments
                    └──────┬───────┘
                           │
              ┌────────────┼──────────────────┐
              │            │                  │
              ▼            ▼                  ▼
     ┌────────────┐ ┌─────────────┐  ┌───────────────┐
     │  APPROVED  │ │  REJECTED   │  │ CHANGES_REQ'D │
     └─────┬──────┘ └──────┬──────┘  └───────┬───────┘
           │               │                  │
           ▼               │                  │
     ┌────────────┐        │         Agent receives feedback
     │  MERGING   │        │         in prompt, re-works task
     └─────┬──────┘        │                  │
           │               │                  ▼
     ┌─────┴──────┐        │         ┌───────────────┐
     │  MERGED    │        │         │   REWORKING    │
     │  (done ✅) │        │         └───────┬───────┘
     └────────────┘        │                  │ Agent pushes new commits
           ▲               │                  │
           │               ▼                  ▼
           │        ┌──────────────┐   Back to PENDING
           │        │  RETURNED    │   (review cycle restarts)
           │        │  (to queue)  │
           │        └──────────────┘
           │
    ┌──────┴────────┐
    │MERGE_CONFLICT  │ ← Detected during merge attempt
    └───────┬───────┘
            │ Auto-delegate to agent
            ▼
    ┌───────────────┐
    │CONFLICT_RESOLV │ ← Agent fixes conflicts, pushes
    └───────┬───────┘
            │ Back to PENDING for re-review
            ▼
         PENDING
```

### 20.3 How "Delegate Conflict to Agent" Works

When a merge conflict is detected (during the MERGING step):

1. **Detection**: Rust `git_manager.rs` attempts the merge and catches conflict markers
2. **Conflict data extracted**: List of conflicting files with conflict markers
3. **UI notification**: Review panel shows "Merge conflict detected in 3 files"
4. **Auto-delegation** (if enabled in settings):
   a. Synk identifies which session/agent worked on this branch
   b. If agent session is still alive: send a prompt to the agent's PTY:
      ```
      There are merge conflicts in your branch {branch} when merging into {base_branch}.
      
      Conflicting files:
      - src/auth/handler.rs
      - src/db/schema.rs
      - tests/auth_test.rs
      
      Please resolve all conflicts and commit the resolution.
      ```
   c. If agent session is dead: spawn a new session with the conflict resolution prompt
   d. Synk watches for new commits on the branch
   e. When a new commit arrives → move ReviewItem back to PENDING
5. **Manual override**: User can always click "Resolve Manually" to open the conflicting files in their editor

### 20.4 Storage

Review data is stored locally in `~/.config/synk/reviews/{project}/`:
```
reviews/
├── {review-id}.json          # ReviewItem serialized
├── comments/
│   └── {review-id}.json      # Array of ReviewComment
└── diffs/
    └── {review-id}.diff      # Cached diff output (regenerated on demand)
```

Diffs are generated on-demand by the Rust backend using `git diff {base_branch}...{branch}` and parsed into the `FileDiff` structure. They're cached but regenerated if the branch has new commits.

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


## 26. Tauri IPC Event Schema

### 26.1 Design Philosophy

All communication between Rust backend and React frontend uses two patterns:
1. **Commands** (frontend → backend): `invoke('command_name', { args })` — request/response
2. **Events** (backend → frontend): `emit('event_name', payload)` — real-time push

Commands are for actions. Events are for state updates.

### 26.2 Commands (Frontend → Backend)

```typescript
// ── Session Management ──────────────────────────────────────

invoke('session:create', {
  agentType: 'claude_code' | 'gemini_cli' | 'codex' | 'terminal',
  projectPath: string,
  branch?: string,
  workingDir?: string,
  env?: Record<string, string>,
}) → { sessionId: number, paneIndex: number }

invoke('session:destroy', { sessionId: number })
  → { success: boolean }

invoke('session:write', { sessionId: number, data: string })
  → void  // fire-and-forget, write to PTY stdin

invoke('session:resize', { sessionId: number, cols: number, rows: number })
  → void

invoke('session:list')
  → SessionInfo[]

// ── Git Operations ──────────────────────────────────────────

invoke('git:create_worktree', {
  sessionId: number,
  branch: string,
  baseBranch?: string,  // default: 'main'
}) → { worktreePath: string, branch: string }

invoke('git:delete_worktree', { sessionId: number })
  → { success: boolean }

invoke('git:diff', {
  branch: string,
  baseBranch: string,
}) → FileDiff[]

invoke('git:merge', {
  branch: string,
  baseBranch: string,
  strategy: 'merge' | 'squash' | 'rebase',
}) → { success: boolean, conflictFiles?: string[] }

invoke('git:branches')
  → string[]

invoke('git:activity', { since?: string })
  → GitEvent[]

// ── Orchestrator ────────────────────────────────────────────

invoke('orchestrator:set_mode', {
  mode: 'gastown' | 'agent_teams' | 'manual' | string,  // string = plugin name
}) → { success: boolean, needsSetup: boolean }

invoke('orchestrator:create_task', { task: TaskDefinition })
  → { taskId: string }

invoke('orchestrator:dispatch_task', { taskId: string, sessionHint?: number })
  → { sessionId: number }

invoke('orchestrator:cancel_task', { taskId: string })
  → { success: boolean }

invoke('orchestrator:list_tasks')
  → TaskStatus[]

invoke('orchestrator:list_agents')
  → AgentStatus[]

invoke('orchestrator:message_agent', { agentId: string, message: string })
  → { success: boolean }

invoke('orchestrator:review_queue')
  → ReviewItem[]

invoke('orchestrator:approve', { taskId: string, strategy: MergeStrategy })
  → { success: boolean }

invoke('orchestrator:reject', { taskId: string, feedback: string })
  → { success: boolean }

// ── AI Provider ─────────────────────────────────────────────

invoke('ai:chat_stream', {
  provider: 'anthropic' | 'google' | 'openai' | 'ollama',
  messages: ChatMessage[],
  systemPrompt: string,
  options?: ChatOptions,
}) → { streamId: string }  // subscribe to events using this ID

invoke('ai:chat_complete', {
  provider: 'anthropic' | 'google' | 'openai' | 'ollama',
  messages: ChatMessage[],
  systemPrompt: string,
  options?: ChatOptions,
}) → { response: string, usage: TokenUsage }

invoke('ai:validate_key', { provider: string, key: string })
  → { valid: boolean, error?: string }

invoke('ai:oauth_start', { provider: string })
  → { authUrl: string }  // open this URL in browser

invoke('ai:oauth_callback', { provider: string, code: string })
  → { success: boolean, email?: string, error?: string }

invoke('ai:oauth_disconnect', { provider: string })
  → { success: boolean }

// ── Skills & MCP ────────────────────────────────────────────

invoke('skills:discover')
  → Skill[]

invoke('skills:toggle', { skillId: string, enabled: boolean, sessionId?: number })
  → { success: boolean }

invoke('mcp:discover')
  → McpServer[]

invoke('mcp:toggle', { serverId: string, enabled: boolean, sessionId?: number })
  → { success: boolean }

invoke('mcp:add', { name: string, command: string, args: string[], env: Record<string, string> })
  → { serverId: string }

// ── Persistence ─────────────────────────────────────────────

invoke('persistence:save_session', { name?: string })
  → { savedPath: string }

invoke('persistence:load_session', { path: string })
  → { sessionCount: number }

invoke('persistence:list_saved')
  → SavedSession[]

// ── Settings ────────────────────────────────────────────────

invoke('settings:get')
  → SynkSettings

invoke('settings:set', { settings: Partial<SynkSettings> })
  → { success: boolean }

// ── Gastown-Specific (only when mode = gastown) ─────────────

invoke('gastown:setup_status')
  → { cliInstalled: boolean, cliVersion?: string, workspaceExists: boolean, rigExists: boolean }

invoke('gastown:run_setup_step', { step: 'install_workspace' | 'add_rig' | 'doctor' | 'doctor_fix' })
  → { output: string, success: boolean }
```

### 26.3 Events (Backend → Frontend)

```typescript
// ── Terminal Output ─────────────────────────────────────────

listen('session:output', {
  sessionId: number,
  data: Uint8Array,         // raw terminal bytes
})  // High frequency — this IS the terminal content

listen('session:exit', {
  sessionId: number,
  exitCode: number,
})

// ── Cost Updates ────────────────────────────────────────────

listen('cost:updated', {
  sessionId: number,
  delta: CostDelta,          // incremental update
  cumulative: CostAccumulator,  // running total for this session
})

// ── Orchestrator Events ─────────────────────────────────────

listen('orchestrator:task_updated', {
  task: TaskStatus,
})

listen('orchestrator:agent_updated', {
  agent: AgentStatus,
})

listen('orchestrator:review_ready', {
  review: ReviewItem,
})

listen('orchestrator:merge_completed', {
  taskId: string,
  branch: string,
  success: boolean,
})

listen('orchestrator:notification', {
  level: 'info' | 'warning' | 'error',
  message: string,
})

// ── Git Events ──────────────────────────────────────────────

listen('git:event', {
  type: 'commit' | 'branch_created' | 'branch_deleted' | 'merge' | 'conflict',
  sessionId: number,
  branch: string,
  details: string,           // commit message, conflict files, etc.
  timestamp: string,
})

// ── AI Streaming ────────────────────────────────────────────

listen('ai:stream_chunk', {
  streamId: string,
  text: string,
})

listen('ai:stream_done', {
  streamId: string,
  usage: TokenUsage,
})

listen('ai:stream_error', {
  streamId: string,
  error: string,
})

// ── Gastown File Watcher ────────────────────────────────────

listen('gastown:state_changed', {
  changeType: 'bead' | 'convoy' | 'polecat' | 'hook' | 'settings',
  entityId: string,
  newState: any,             // parsed JSON from the changed file
})

// ── System ──────────────────────────────────────────────────

listen('pool:status', {
  idle: number,
  active: number,
  total: number,
})

listen('app:error', {
  source: string,            // which subsystem
  message: string,
  recoverable: boolean,
})
```

### 26.4 Event Flow Diagrams

**Creating a new session (command flow):**
```
React                              Rust
  │                                  │
  │ invoke('session:create', {...})   │
  │─────────────────────────────────▶│
  │                                  │ 1. Claim PTY from pool
  │                                  │ 2. cd to project dir
  │                                  │ 3. Start agent command
  │  { sessionId: 3, paneIndex: 2 }  │
  │◀─────────────────────────────────│
  │                                  │
  │  listen('session:output')        │
  │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │ (continuous stream)
  │  listen('session:output')        │
  │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
  │  listen('cost:updated')          │
  │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │ (when cost pattern matched)
  │                                  │
```

**Dispatching a task in Gastown mode:**
```
React                     Rust                          Gastown
  │                         │                              │
  │ invoke('orchestrator:   │                              │
  │   create_task', {...})  │                              │
  │────────────────────────▶│                              │
  │                         │ bd create --title "..."      │
  │                         │─────────────────────────────▶│
  │                         │ (bead ID returned)           │
  │                         │◀─────────────────────────────│
  │  { taskId: "gt-abc12" } │                              │
  │◀────────────────────────│                              │
  │                         │                              │
  │ invoke('orchestrator:   │                              │
  │   dispatch_task', {...})│                              │
  │────────────────────────▶│                              │
  │                         │ gt sling gt-abc12 rig --naked│
  │                         │─────────────────────────────▶│
  │                         │ (process spawned)            │
  │                         │◀─────────────────────────────│
  │                         │                              │
  │                         │ Capture process in PTY pool  │
  │                         │ Emit session:output events   │
  │  { sessionId: 4 }      │                              │
  │◀────────────────────────│                              │
  │                         │                              │
  │  listen('orchestrator:  │   (file watcher detects      │
  │    task_updated')       │    bead status change)       │
  │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │◀ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
  │                         │                              │
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


