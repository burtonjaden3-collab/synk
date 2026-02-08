# Synk — Build Guide & Agent Dispatch Plan
### For use with Claude Code / Codex / AI coding agents
### Follows Option B: Single session Phases 1-2, parallel Phase 3+

---

## How to Use This Guide

Each task lists:
- **What to build** — concrete deliverable
- **Spec sections to feed** — copy ONLY these sections into your agent's context
- **Depends on** — what must exist before starting this task
- **Files touched** — so you know what conflicts with what

**Context strategy:** The full spec is ~4,000 lines. No agent can hold it all. For each task, extract the listed spec sections into a focused context document. Include the file structure (§14) in every task so the agent knows where things go.

**Rule of thumb:** Keep agent context under 1,500 lines of spec + the existing code it needs to modify.

---

## Conventions (Read Before Starting)

### Tooling + Version Pinning

- **Canonical dev entrypoint:** `npm run tauri dev` (uses the project-local Node CLI).
- **Reproducibility:** use `npm ci` (enforces `package-lock.json`).
- **Tauri CLI alignment:**
  - Node CLI is pinned in `package.json` and locked in `package-lock.json`.
  - If you use the Rust subcommand (`cargo tauri ...`), install the same version:
    ```bash
    cargo install tauri-cli --version 2.10.0 --locked
    cargo tauri --version
    ```

### Data Locations

- **Per-project persistent state:**
  - `/<project>/.synk/config.json`
  - `/<project>/.synk/sessions/`
  - `/<project>/.synk/stats/` (optional derived metrics; OK to regenerate)
- **Global app state (via Tauri path APIs):**
  - `projects.json` (recent projects list)
  - `settings.json` (provider auth, performance tuning, keybind overrides)

## PHASE 1 — Foundation (Single Session)

Everything builds sequentially. One agent, one session.

### Task 1.1: Tauri Scaffold
**What:** Initialize Tauri v2 project with Rust backend + React + TypeScript frontend. Install core dependencies (xterm.js, zustand, tailwind). Verify `npm run tauri dev` runs.

**Status:** Done (2026-02-07). See `6fd62be` (scaffold) and `cdb32ca` (Phase 1 wiring + capability baseline).

**Spec sections:** §2 (Tech Stack), §14 (File Structure)

**Depends on:** Nothing — this is step zero.

**Files touched:**
```
Everything — this creates the project skeleton
src-tauri/Cargo.toml, src-tauri/tauri.conf.json, src-tauri/src/main.rs, src-tauri/src/lib.rs
src/App.tsx, package.json, tailwind.config.js, tsconfig.json
```

**Notes:** Agent should create the full directory structure from §14 with empty placeholder files. This prevents future agents from having to guess where things go.
For dev, prefer the project-local CLI:

```bash
npm ci
npm run tauri dev
```

If you specifically want `cargo tauri ...` (Rust subcommand), install it once (version-pinned):

```bash
cargo install tauri-cli --version 2.10.0 --locked
cargo tauri --version
```

---

### Task 1.1a: Capabilities/Permissions Baseline
**What:** Decide what runs via Rust backend vs Tauri plugins, then set capabilities/permissions accordingly so later phases don't stall on security plumbing.

**Status:** Done (2026-02-07). See `cdb32ca`.

**Spec sections:** §26 (IPC overview), §34 (Data Storage), any plugin-related spec sections you plan to implement next

**Depends on:** Task 1.1 (project exists)

**Files touched:**
```
src-tauri/capabilities/*.json (update plugin permissions)
src-tauri/Cargo.toml         (add/remove tauri-plugin-* crates)
package.json                 (add/remove @tauri-apps/plugin-* packages)
```

**Acceptance test:** Enabled plugins (currently opener + dialog) work without permission errors; deferred features are clearly omitted.

---

### Task 1.2: PTY Process Pool
**What:** Implement the pre-warmed PTY process pool in Rust. Spawn shells, detect deterministic readiness marker (prompt regex only as fallback), claim/release/recycle lifecycle.

**Status:** Done (2026-02-07). See `cbfaa89` and `94b48c3`.

**Spec sections:** §22 (PTY Process Pool — full section), §13 (Performance Targets — spawn time, latency)

**Depends on:** Task 1.1 (project exists)

**Files touched:**
```
src-tauri/src/core/process_pool.rs    (new — main implementation)
src-tauri/src/core/session_manager.rs (new — skeleton, uses pool)
src-tauri/src/lib.rs                  (module declarations)
```

**Acceptance test:** Run the app, verify 2 idle PTY processes exist in the background (Phase 1 ok: temporary debug command). Claim one, verify a replacement spawn is scheduled within ~200ms.

---

### Task 1.3: Session Manager + IPC
**What:** Session CRUD: create session (claim from pool), write to PTY, resize, destroy. Wire up Tauri IPC commands and events for terminal I/O.

**Status:** Done (2026-02-07). See `cdb32ca`.

**Spec sections:** §26 (Tauri IPC — session commands + session events ONLY), §8.1-8.4 (Session Management), §22 (Pool — how claim/release works)

**Depends on:** Task 1.2 (pool exists)

**Files touched:**
```
src-tauri/src/core/session_manager.rs (implement)
src-tauri/src/commands/session.rs     (new — Tauri command handlers)
src-tauri/src/events.rs               (new — event type definitions)
src-tauri/src/lib.rs                  (register commands)
```

**Acceptance test:** From the frontend, invoke `session_create`, receive session ID. Write bytes, receive `session:output` events.

---

### Task 1.4: Terminal Grid UI
**What:** React session grid with xterm.js rendering. Auto-reflow layout (1×1 through 4×3, where notation is `cols×rows`). Pane headers with agent badge and status dot. Connect to session IPC.

**Status:** Done (2026-02-07). See `cdb32ca`.

**Spec sections:** §8.1 (Grid Layout table), §11 (UI Design — colors, typography), §3 (Core Architecture — layout diagram), §26 (IPC — session:output event)

**Depends on:** Task 1.3 (session IPC works)

**Files touched:**
```
src/components/workspace/Workspace.tsx    (new)
src/components/workspace/SessionGrid.tsx  (new)
src/components/workspace/SessionPane.tsx  (new)
src/lib/tauri-api.ts                      (new — invoke wrappers)
src/lib/types.ts                          (new — TypeScript interfaces)
src/App.tsx                               (routing)
src/styles/                               (tailwind config)
```

**Acceptance test:** Open app, create 1-6 sessions via a temp button. See terminal grids reflow. Type in a pane, see shell output render.

---

### Task 1.5: Vim Navigation
**What:** Implement two-mode system (Navigation ↔ Terminal). h/j/k/l pane movement, Enter to focus, double-Escape to exit. Visual focus indicators (blue/green borders).

**Status:** Done (2026-02-08).

**Spec sections:** §25 (Vim Navigation — full section), §12 (Keyboard shortcuts table)

**Depends on:** Task 1.4 (grid exists with panes to navigate)

**Files touched:**
```
src/lib/keybindings.ts                    (new — key event handler)
src/components/workspace/Workspace.tsx    (add key listener)
src/components/workspace/SessionPane.tsx  (focus state styling)
```

**Acceptance test:** Navigate between panes with h/j/k/l. Press Enter, type into terminal. Double-Escape returns to navigation. Borders change color correctly.

---

### Task 1.6: Home Screen
**What:** Build the home screen with "New Project" button, recent projects list (reads from projects.json), and dashboard stats placeholder.

**Status:** Done (2026-02-08).

**Spec sections:** §4.1 (Home Screen), §28 (Project Configuration — projects.json schema), §11 (UI Design)

**Depends on:** Task 1.4 (basic app shell exists)

**Files touched:**
```
src/components/home/HomeScreen.tsx     (new)
src/components/home/DashboardStats.tsx (new)
src/App.tsx                            (add routing: home ↔ workspace)
src/lib/store.ts                       (new — Zustand store skeleton)
src-tauri/src/main.rs                  (register dialog plugin if implementing native folder picker)
src-tauri/Cargo.toml                   (add dialog plugin dependency if implementing native folder picker)
package.json                           (add @tauri-apps/plugin-dialog if implementing native folder picker)
```

**Acceptance test:** App opens to home screen. Click "Open Folder" → select a directory (native dialog via Tauri dialog plugin) → transitions to workspace with empty grid.

---

### Task 1.7: Agent Mode Selection
**What:** When creating a session, pick agent type (Claude Code, Gemini CLI, Codex, Terminal). Auto-detect installed agents. Launch correct command in PTY.

**Status:** Done (2026-02-08).

**Spec sections:** §8.2 (Supported Agents table), §29 (Onboarding — agent detection step)

**Depends on:** Task 1.3 (session creation works)

**Files touched:**
```
src-tauri/src/core/agent_detection.rs  (new)
src-tauri/src/commands/agents.rs      (new)
src-tauri/src/lib.rs                  (manage agent registry; register command)
src-tauri/permissions/synk.json       (allow invoke command)
src-tauri/src/core/session_manager.rs  (add agent type handling)
src-tauri/src/commands/session.rs      (accept agentType on the wire; support agent_type as an alias in Rust)
src/components/workspace/Workspace.tsx  (agent selector + warnings)
src/components/workspace/SessionPane.tsx (agent badge in header)
src/lib/types.ts                        (AgentType enum)
src/lib/tauri-api.ts                    (invoke wrapper)
```

**Acceptance test:** Create a Claude Code session — `claude` command launches. Create a Terminal session — `$SHELL` launches. Missing agent shows warning.

---

## PHASE 2 — Sidebar & Configuration (Single Session)

Still sequential. Building on Phase 1's foundation.

### Task 2.1: Sidebar Shell
**What:** Collapsible sidebar with section headers. Project selector, orchestrator mode selector (UI only — no backend yet), session list.

**Spec sections:** §5 (Sidebar — all subsections), §11 (UI Design), §3 (layout diagram)

**Depends on:** Task 1.4 (workspace layout exists)

**Files touched:**
```
src/components/sidebar/Sidebar.tsx              (new)
src/components/sidebar/ProjectSelector.tsx      (new)
src/components/sidebar/OrchestratorControls.tsx (new — skeleton)
src/components/sidebar/AgentStatusOverview.tsx  (new)
src/components/workspace/Workspace.tsx          (add sidebar to layout)
```

---

### Task 2.2: Skills & MCP Discovery
**What:** Auto-detect skills and MCP servers from Claude config files. Display in sidebar with toggle switches.

**Spec sections:** §39 (Skills & MCP File Parsing — full section), §10 (Skills & MCP Discovery), §5.2-5.3 (Sidebar skills/MCP sections)

**Depends on:** Task 2.1 (sidebar exists)

**Files touched:**
```
src-tauri/src/core/skills_discovery.rs  (new)
src-tauri/src/core/mcp_discovery.rs     (new)
src-tauri/src/commands/skills.rs        (new)
src-tauri/src/commands/mcp.rs           (new)
src/components/sidebar/SkillsBrowser.tsx (new)
src/components/sidebar/McpManager.tsx   (new)
```

---

### Task 2.3: Per-Session Configuration
**What:** Click a session in sidebar → see/edit its config (agent type, branch, worktree toggle, skills, MCP). Save to project config.

**Spec sections:** §5.4 (Session Config), §28 (Project Configuration — .synk/config.json schema), §34 (Data Storage)

**Depends on:** Task 2.1 + 2.2

**Files touched:**
```
src/components/sidebar/SessionConfig.tsx (new)
src-tauri/src/commands/persistence.rs    (new — read/write .synk/config.json)
src/lib/store.ts                         (add session config to store)
```

---

### Task 2.4: Session Persistence
**What:** Save/restore session layouts. Auto-save every 60s. Crash recovery on next launch.

**Spec sections:** §32 (Session Persistence — full section), §34 (Data Storage — sessions/ directory)

**Depends on:** Task 2.3 (session config exists to save)

**Files touched:**
```
src-tauri/src/commands/persistence.rs (extend)
src/lib/store.ts                      (save/restore actions)
src/components/home/HomeScreen.tsx    (crash recovery prompt)
```

---

### Task 2.5: Settings Panel
**What:** Full settings UI with all tabs. API key + OAuth setup. Performance tuning. Keyboard config.

**Spec sections:** §33 (Settings Schema — full section), §18.2.1 (Dual Auth Strategy), §34 (Data Storage — settings.json)

**Depends on:** Task 2.1 (sidebar/app chrome exists)

**Files touched:**
```
src/components/shared/Settings.tsx  (new — big component)
src-tauri/src/commands/settings.rs  (new — read/write settings.json)
src/lib/store.ts                    (settings state)
```

---

### Task 2.6: First Run Onboarding
**What:** First-launch wizard: welcome → AI provider setup (dual auth) → agent detection → first project.

**Spec sections:** §29 (First Run — full section), §18.2.1 (Dual Auth)

**Depends on:** Task 2.5 (settings exist to write to)

**Files touched:**
```
src/components/onboarding/OnboardingWizard.tsx  (new)
src/components/onboarding/ProviderSetup.tsx     (new)
src/components/onboarding/AgentDetection.tsx    (new)
src/App.tsx                                      (route to onboarding if first run)
```

---

## PHASE 3 — Git Integration & Review (Start Splitting: 2 Sessions)

From here on, backend and frontend can work in parallel because the IPC schema (§26) acts as the contract between them.

### Session A (Backend): Git Manager + Worktree Engine

#### Task 3A.1: Git Worktree Manager
**What:** Create/delete worktrees, branch management, orphan detection, cleanup.

**Spec sections:** §37 (Worktree Lifecycle — full section), §26 (IPC — git commands)

**Files touched:**
```
src-tauri/src/core/git_manager.rs  (new)
src-tauri/src/commands/git.rs      (new)
```

#### Task 3A.2: Diff Generation + Merge Engine
**What:** Generate diffs between branches, execute merges (merge/squash/rebase), detect conflicts, extract conflict file lists.

**Spec sections:** §20 (PR Review — data model, state machine, conflict delegation), §26 (IPC — git:diff, git:merge)

**Files touched:**
```
src-tauri/src/core/git_manager.rs  (extend)
src-tauri/src/commands/git.rs      (extend)
src-tauri/src/commands/review.rs   (new)
```

### Session B (Frontend): Review UI

#### Task 3B.1: Bottom Drawer Shell
**What:** Resizable bottom drawer with 4 draggable/rearrangeable panel tabs. Just the container — panel contents come later.

**Spec sections:** §6 (Bottom Drawer overview), §11 (UI Design)

**Files touched:**
```
src/components/drawer/BottomDrawer.tsx  (new)
src/components/workspace/Workspace.tsx  (add drawer to layout)
```

#### Task 3B.2: Git Activity Feed
**What:** Real-time git event feed (commits, branches, merges). Clickable entries.

**Spec sections:** §6.2 (Git Activity Feed), §26 (IPC — git:event)

**Files touched:**
```
src/components/drawer/GitActivityFeed.tsx (new)
```

#### Task 3B.3: Review Panel + Diff Viewer
**What:** PR-style review: file list, side-by-side diff, line comments, approve/reject/request changes buttons.

**Spec sections:** §20 (PR Review — full section), §6.4 (Review Queue), §26 (IPC — review commands)

**Files touched:**
```
src/components/review/ReviewPanel.tsx    (new)
src/components/review/DiffViewer.tsx     (new)
src/components/review/CommentThread.tsx  (new)
src/components/drawer/ReviewQueue.tsx    (new)
```

---

## PHASE 4 — Orchestration (3 Sessions)

Three agents working on completely separate subsystems. Interfaces defined in §16, no file overlap.

### Session A: Gastown Adapter (Backend)

#### Task 4A.1: Gastown Setup Wizard Backend
**What:** Detect CLI, check workspace, add rig, run doctor. All via visible commands.

**Spec sections:** §15.4 (Setup Wizard)

**Files touched:**
```
src-tauri/src/orchestrator/gastown/setup_wizard.rs (new)
```

#### Task 4A.2: Gastown CLI Executor
**What:** Wrapper for gt/bd commands. Parse output. Execute in visible PTY panes.

**Spec sections:** §15 (Gastown Integration — full section), §16 (Adapter Trait)

**Depends on:** Task 4A.1 (CLI detected + workspace validated)

**Files touched:**
```
src-tauri/src/orchestrator/mod.rs              (implement trait)
src-tauri/src/orchestrator/gastown/mod.rs      (new)
src-tauri/src/orchestrator/gastown/cli.rs      (new)
src-tauri/src/orchestrator/gastown/types.rs    (new)
```

#### Task 4A.3: Gastown File Watcher + State Reconciler
**What:** Cross-platform file watcher on ~/gt/ (use `notify` crate; inotify backend on Linux), parse file changes, emit orchestrator events, polling fallback.

**Spec sections:** §15.6 (State Reconciliation), §15.7 (Error Handling)

**Depends on:** Task 4A.1 (validated paths exist)

**Files touched:**
```
src-tauri/src/orchestrator/gastown/file_watcher.rs  (new)
src-tauri/src/orchestrator/gastown/reconciler.rs    (new)
```

### Session B: Orchestrator Frontend

#### Task 4B.1: Task Queue Panel
**What:** Kanban-style task board in bottom drawer. Create tasks, drag to reorder, show dependencies.

**Spec sections:** §21 (Task Queue & Dispatch — full section), §6.3 (Task Queue UI)

**Files touched:**
```
src/components/drawer/TaskQueue.tsx (new)
src/lib/store.ts                   (add task state)
```

#### Task 4B.2: Gastown Setup Wizard UI
**What:** Step-by-step setup wizard with embedded terminal panes showing gt commands.

**Spec sections:** §15.4 (Setup Wizard), §29 (Onboarding — integration setup pattern)

**Files touched:**
```
src/components/gastown/GastownSetupWizard.tsx (new)
src/components/gastown/GastownDiagnostics.tsx (new)
```

#### Task 4B.3: Orchestrator Controls in Sidebar
**What:** Mode selector (Gastown/Agent Teams/Manual), dispatch button, agent status cards that update from orchestrator events.

**Spec sections:** §5.5 (Orchestrator Controls), §5.6 (Agent Status), §26 (IPC — orchestrator events)

**Files touched:**
```
src/components/sidebar/OrchestratorControls.tsx (implement)
src/components/sidebar/AgentStatusOverview.tsx  (implement)
```

### Session C: Agent Teams + Manual Adapters

#### Task 4C.1: Agent Teams Adapter
**What:** PTY output parser for Claude Code subagent detection. Sidebar monitor component.

**Spec sections:** §17 (Agent Teams — full section), §16 (Adapter Trait)

**Files touched:**
```
src-tauri/src/orchestrator/agent_teams.rs (new)
```

#### Task 4C.2: Manual Mode Adapter
**What:** Simple local task list, no orchestration. Command bar dispatch only.

**Spec sections:** §7.3 (Manual Mode), §16 (Adapter Trait)

**Files touched:**
```
src-tauri/src/orchestrator/manual.rs (new)
```

---

## PHASE 5 — Brainstorm Wizard & Planner (2 Sessions)

### Session A: AI Provider Backend

#### Task 5A.1: AI Provider Router
**What:** Provider trait, all 4 implementations (Anthropic, Google, OpenAI, Ollama), dual auth (API key + OAuth), streaming SSE parser.

**Spec sections:** §18 (AI Provider Router — full section), §26 (IPC — ai commands)

**Files touched:**
```
src-tauri/src/ai/mod.rs        (new — trait)
src-tauri/src/ai/anthropic.rs  (new)
src-tauri/src/ai/google.rs     (new)
src-tauri/src/ai/openai.rs     (new)
src-tauri/src/ai/ollama.rs     (new)
src-tauri/src/commands/ai_provider.rs (new)
```

#### Task 5A.2: CLAUDE.md Generator
**What:** Generate and maintain CLAUDE.md with size constraints. Auto-update on task state changes.

**Spec sections:** §30 (CLAUDE.md Generation — full section), §19.4 (Blueprint as Agent Context)

**Files touched:**
```
src-tauri/src/core/claudemd_generator.rs (new)
```

### Session B: Wizard Frontend

#### Task 5B.1: Brainstorm Chat UI
**What:** Full-screen conversational chat with AI. Provider selector. Streaming response rendering. Structured data extraction display.

**Spec sections:** §4.2 (Brainstorm Wizard), §18.3-18.5 (Conversation state, prompt templates, streaming)

**Files touched:**
```
src/components/wizard/BrainstormWizard.tsx  (new)
src/components/wizard/ChatBrainstorm.tsx    (new)
src/components/wizard/StructuredExtract.tsx (new)
```

#### Task 5B.2: Blueprint Viewer + Editor
**What:** Mermaid diagram rendering, code editor, live preview. All 5 diagram types.

**Spec sections:** §19 (Mermaid Blueprints — full section, prompt templates)

**Files touched:**
```
src/components/wizard/BlueprintViewer.tsx (new)
src/components/wizard/BlueprintEditor.tsx (new)
src/lib/mermaid-utils.ts                 (new)
```

#### Task 5B.3: Export Panel + Convoy Export
**What:** All 5 export options. Blueprint → Gastown convoy conversion. Scaffolded directory creation.

**Spec sections:** §4.2 Step 4 (Export), §36 (Blueprint → Convoy Export — full section)

**Files touched:**
```
src/components/wizard/ExportPanel.tsx (new)
```

#### Task 5B.4: Floating Mermaid Planner
**What:** Toggleable floating panel for existing projects. Live node status. Right-click to link nodes to tasks.

**Spec sections:** §4.3 (Floating panel), §19.3 (Live node status)

**Files touched:**
```
src/components/planner/MermaidFloatingPanel.tsx (new)
```

---

## PHASE 6 — Polish & Performance (2-3 Sessions)

### Session A: Command Bar + Broadcast

#### Task 6A.1: Command Bar
**What:** Spotlight-style input with autocomplete. Full command set. Session targeting with @ syntax.

**Spec sections:** §31 (Command Bar — full section)

**Files touched:**
```
src/components/workspace/CommandBar.tsx (new)
src/lib/keybindings.ts                 (add / trigger)
```

#### Task 6A.2: Broadcast Mode
**What:** Ctrl+b toggle, visual indicators, @idle/@active/@all targeting.

**Spec sections:** §38 (Broadcast Mode — full section)

**Files touched:**
```
src/components/workspace/Workspace.tsx   (broadcast state)
src/components/workspace/SessionPane.tsx (red border styling)
src/lib/keybindings.ts                   (Ctrl+b handler)
```

### Session B: Cost Tracker + Notifications

#### Task 6B.1: Cost Tracking
**What:** Per-agent output parsers (Claude Code, Gemini, Codex regex patterns). Cost accumulator. Pricing table. UI in bottom drawer + pane headers.

**Spec sections:** §23 (Cost Tracking — full section), §6.1 (Cost Tracker UI)

**Files touched:**
```
src-tauri/src/core/cost_tracker.rs     (new)
src/components/drawer/CostTracker.tsx  (new)
```

#### Task 6B.2: Notification System
**What:** Toast notifications, notification history log, bell icon with badge. All event types.

**Spec sections:** §35 (Notification System — full section)

**Files touched:**
```
src/components/shared/Notifications.tsx       (new)
src/components/shared/NotificationHistory.tsx (new)
```

### Session C: Plugin System + Final Polish

#### Task 6C.1: Plugin Loader
**What:** Dynamic plugin loading (.so/.dylib/.dll), plugin.toml parsing, SDK crate scaffold, plugin UI in settings.

**Spec sections:** §24 (Plugin API — full section)

**Files touched:**
```
src-tauri/src/orchestrator/mod.rs  (add plugin loading)
synk-plugin-sdk/                   (new crate)
```

#### Task 6C.2: Dashboard Stats
**What:** Home screen aggregate stats (total sessions, cost, tasks, estimated hours saved). Read from stats files.

**Spec sections:** §4.1 (Home Screen dashboard), §34 (Data Storage — stats/)

**Files touched:**
```
src/components/home/DashboardStats.tsx (implement)
```

#### Task 6C.3: Performance Audit
**What:** Profile against §13 targets. Optimize PTY pool, terminal rendering, idle CPU. Fix any regressions.

**Spec sections:** §13 (Performance Targets)

**Files touched:** Potentially anything — this is an optimization pass.

---

## Summary: Session Count by Phase

| Phase | Sessions | Approach | Est. Tasks |
|-------|----------|----------|------------|
| 1 — Foundation | 1 | Sequential, single agent | 7 |
| 2 — Sidebar & Config | 1 | Sequential, single agent | 6 |
| 3 — Git & Review | 2 | Backend (A) + Frontend (B) | 5 |
| 4 — Orchestration | 3 | Gastown (A) + Frontend (B) + Other adapters (C) | 8 |
| 5 — Wizard & Planner | 2 | AI backend (A) + Wizard frontend (B) | 6 |
| 6 — Polish | 2-3 | Feature groups with no overlap | 6 |
| **Total** | | | **38 tasks** |

## Key Rules for Agent Sessions

1. **Always include §14 (File Structure)** in every agent's context — it's the map.
2. **Always include relevant §26 (IPC) subsections** — it's the contract between frontend and backend.
3. **Never feed an agent more than 1,500 lines of spec** — diminishing returns past that.
4. **After each task, commit and push** before starting the next — clean checkpoints.
5. **After Phase 1 completes, all future agents should read the existing code** they're extending, not just the spec.
6. **Test after every task** — don't let broken foundations compound.
