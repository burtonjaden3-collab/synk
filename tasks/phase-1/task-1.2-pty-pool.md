# TASK 1.2: PTY Process Pool
> Phase 1 — Foundation | Single Session | Depends on: Task 1.1

## What to Build
Implement a pre-warmed PTY process pool in Rust. On app launch, fork 2 idle shell processes. Provide claim/release/recycle lifecycle methods. Replace claimed shells automatically.

## Implementation Choice (Phase 1)
- Use `portable-pty` for Linux-friendly PTY creation and child process spawning.
- Use deterministic readiness markers (`__SYNK_READY__:<token>`) and a real timeout (poll the PTY master fd) to avoid blocking forever on reads.

## Deliverables
1. `process_pool.rs` — ProcessPool struct with new(), claim(), release(), recycle(), shutdown()
2. Warm-up detection via deterministic readiness marker (prompt regex as fallback)
3. Pool auto-replenishes when a shell is claimed
4. Shells older than 30min get replaced
5. On-demand spawn fallback if pool is exhausted
6. Skeleton `session_manager.rs` that uses the pool

## Files to Create/Modify
```
src-tauri/src/core/process_pool.rs    (new — main implementation)
src-tauri/src/core/session_manager.rs (new — skeleton, calls pool.claim())
src-tauri/src/core/mod.rs             (module declarations)
src-tauri/src/lib.rs                  (register core module)
```

## Acceptance Test
App launches → 2 idle PTY processes running in background.

- Verify pool warmup: invoke a temporary debug command (Phase 1 ok) like `debug_pool_stats` and confirm `idle >= 2`.
- Call `claim()` → get a shell.
- Verify a replacement spawn is scheduled within ~200ms and `idle` returns to 2 within the warm-up timeout.
- Verify claimed shell responds: run a simple `echo` roundtrip (temporary debug command is ok in Phase 1).

---
## SPEC REFERENCE (Read all of this carefully)
## 22. PTY Process Pool — Implementation Detail

### 22.1 Pool Architecture

```rust
pub struct ProcessPool {
    idle_pool: VecDeque<PtyHandle>,       // pre-warmed, waiting to be claimed (FIFO)
    active: HashMap<usize, PtyHandle>, // session_index → handle
    config: PoolConfig,
    recycler_tx: mpsc::Sender<PtyHandle>,  // channel for returning PTYs
}

pub struct PtyHandle {
    pid: u32,
    master_fd: OwnedFd,             // PTY master handle (conceptual; may be a raw fd or crate-specific handle)
    // NOTE: Keep this handle abstract in Phase 1. Practical implementations either:
    // - use `forkpty()` and store pid + master fd, or
    // - use a PTY crate (e.g. portable-pty) and store its child + master handles.
    shell: String,                   // e.g., "/bin/bash"
    created_at: Instant,
    state: PtyState,
}

pub enum PtyState {
    Warming,   // just spawned, running shell init
    Idle,      // in pool, ready to claim
    Active,    // assigned to a session
    Recycling, // being cleaned for reuse
    Dead,      // process exited
}

pub struct PoolConfig {
    pub initial_pool_size: usize,    // default: 2
    pub max_pool_size: usize,        // default: 4
    pub max_active: usize,           // default: 12 (grid max)
    pub recycle_enabled: bool,       // default: true
    pub max_pty_age: Duration,       // default: 30 minutes (before forced recycle)
    pub warmup_delay: Duration,      // default: 100ms between spawns
    pub warmup_timeout: Duration,    // default: 5s (readiness marker must be observed)
    pub recycle_timeout: Duration,   // default: 2s (recycle readiness check)
}
```

### 22.2 Lifecycle

```
App Launch
    │
    ▼
Spawn initial_pool_size PTYs (staggered by warmup_delay)
    │  Each: spawn PTY → exec($SHELL) → wait for readiness marker
    │  State: Warming → Idle
    ▼
Pool ready (2-4 idle PTYs)
    │
    ├── User creates new session ──────────────────────────────┐
    │   1. Claim idle PTY from pool (FIFO)                     │
    │   2. cd to project directory                             │
    │   3. Set env vars (SYNK_SESSION=n, SYNK_PROJECT=...)     │
    │   4. If agent mode: exec agent command (replaces shell)  │
    │   5. State: Idle → Active                                │
    │   6. If pool < initial_pool_size: spawn replacement      │
    │   Return: PtyHandle to session_manager                   │
    │                                                          │
    ├── User closes session ───────────────────────────────────┤
    │   If recycle_enabled AND pty_age < max_pty_age:          │
    │     1. Send Ctrl+C, wait 500ms                           │
    │     2. Send `cd ~ && clear && reset`                     │
    │     3. Verify shell prompt appears (within 2s timeout)   │
    │     4. If healthy: State → Idle, return to pool          │
    │     5. If unhealthy: kill and spawn fresh                │
    │   Else:                                                  │
    │     1. Kill process (SIGTERM, then SIGKILL after 3s)     │
    │     2. Close file descriptors                            │
    │     3. Spawn replacement if pool < initial_pool_size     │
    │                                                          │
    ├── Pool exhausted (all claimed, none idle) ───────────────┤
    │   1. If active < max_active: spawn on-demand (no pool)   │
    │      → slightly slower (~200ms extra) but still works    │
    │   2. If active == max_active: return error               │
    │      → UI shows "Max sessions reached (12)"              │
    │                                                          │
    └── App shutdown ──────────────────────────────────────────┘
        1. Send SIGTERM to all active PTYs
        2. Wait 3s for graceful exit
        3. SIGKILL any remaining
        4. Close all file descriptors
```

### 22.3 Warm-Up Strategy

Why pre-warming matters: shell startup (~150-400ms for bash with .bashrc) is the single biggest contributor to perceived "lag" when opening a new session. By doing it ahead of time, the user sees instant response.

**What happens during warm-up:**
1. `forkpty()` creates a pseudo-terminal pair
2. Child process `exec("/bin/bash", ["--login"])` (or `$SHELL`)
3. Shell reads `.bashrc`, `.profile`, etc.
4. Synk writes a unique marker command to stdin (example):
   - `printf "__SYNK_READY__:%s\\n" "a1b2c3"` (token generated by Synk, unique per PTY)
5. Synk watches PTY output for that marker (string match).
6. Once marker observed → State: `Warming` → `Idle`
7. If marker not observed within 5s → kill and retry (shell config may be broken)

**Fallback:** If marker detection fails for some reason, a prompt regex can be used as a secondary signal, but it should not be the primary mechanism (prompts are user-configurable and often nonstandard).

**Pool refill logic:**
- After claiming a PTY, if `idle_pool.len() < initial_pool_size`, spawn a replacement in the background
- Spawn delay: 100ms after the claim (avoid I/O contention with the session that just started)

### 22.4 Tuning Guidance

| System | Recommended `initial_pool_size` | Recommended `max_pool_size` |
|--------|--------------------------------|----------------------------|
| 8GB RAM, 4 cores | 2 | 3 |
| 16GB RAM, 8 cores | 3 | 4 |
| 32GB+ RAM, 12+ cores | 4 | 6 |

Each idle PTY consumes ~5-10MB RAM (bash process + terminal buffer). Active sessions with AI agents consume 30-50MB.

Settings UI exposes these as sliders under "Performance" → "Process Pool" with a real-time RAM estimate.

---


## 13. Performance Targets

| Metric | Target |
|--------|--------|
| App cold start → home screen | < 1.5 seconds |
| New session spawn (from pool) | < 300ms |
| Terminal input latency | < 16ms (60fps) |
| Grid reflow on add/remove | < 100ms |
| Memory per session | < 50MB |
| Idle CPU usage (12 sessions) | < 5% |
| Mermaid diagram render | < 200ms |
| Brainstorm wizard AI response | Network-bound (streaming) |

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
