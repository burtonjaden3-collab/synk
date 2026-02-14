# Knowledge Base Structure (CLAUDE.md + docs/ Restructure)

**Priority:** 9 (Workflow improvement — implement when ready)
**Inspired by:** OpenAI Harness Engineering — progressive disclosure, repo as system of record
**Status:** Spec

---

## Overview

Create a project-level `.claude/CLAUDE.md` for Synk and restructure the `docs/` directory into the Harness pattern. This is a workflow improvement, not a Synk feature — it makes every Claude/Codex session in the Synk repo immediately productive by providing a short context map and a structured knowledge base.

---

## Decisions

| Question | Answer |
|----------|--------|
| CLAUDE.md length | ~100 lines — table of contents, not encyclopedia |
| docs/ structure | Harness-inspired: design-docs, exec-plans, product-specs, references |
| What moves? | Build guide stays, existing plan stays, new directories created |
| references/ content | llms.txt or context files for key dependencies (Tauri, xterm.js, Zustand) |
| Maintenance | Doc gardening (priority 6) keeps it fresh once implemented |

---

## Target Structure

```
synk/
├── .claude/
│   └── CLAUDE.md                    # ~100 line project map (NEW)
├── docs/
│   ├── design-docs/                 # Architecture decisions (NEW)
│   │   ├── index.md                 # Catalog of all design docs
│   │   └── ...                      # Individual design decisions
│   ├── exec-plans/                  # Execution plans (NEW — for priority 4)
│   │   ├── active/
│   │   ├── completed/
│   │   └── tech-debt-tracker.md
│   ├── product-specs/               # Feature specifications (NEW)
│   │   ├── index.md
│   │   └── ...                      # Individual feature specs
│   ├── plans/                       # Existing — keep as-is
│   │   ├── 2026-02-10-project-tabs-design.md
│   │   ├── 01-agent-review-loops.md
│   │   ├── ...etc (the specs from this session)
│   ├── references/                  # Dependency context for agents (NEW)
│   │   ├── tauri-v2-reference.md
│   │   ├── xterm-js-reference.md
│   │   └── zustand-reference.md
│   ├── SYNK_BUILD_GUIDE.md          # Existing — keep
│   ├── ARCHITECTURE.md              # Top-level architecture map (NEW)
│   └── QUALITY_SCORE.md             # Quality grades per module (NEW — for priority 3)
```

---

## CLAUDE.md Content Outline

```markdown
# Synk — AI Agent Command Center

## What This Is
Desktop app (Tauri v2) for orchestrating multiple AI coding agents
from a single workspace. Manages sessions, git worktrees, cost tracking,
and agent collaboration.

## Tech Stack
- Backend: Rust + Tauri v2
- Frontend: React 19 + TypeScript + Tailwind CSS
- Terminal: xterm.js (WebGL)
- State: Zustand
- PTY: portable-pty crate

## Architecture
See docs/ARCHITECTURE.md for full architecture map.
- src-tauri/src/core/ — Business logic modules (one per domain)
- src-tauri/src/commands/ — Tauri IPC command handlers (one per domain)
- src/components/ — React components organized by feature area
- src/lib/ — Shared utilities, types, store, Tauri API wrapper

## Key Modules
| Module | Backend | Frontend | Purpose |
|--------|---------|----------|---------|
| Sessions | core/session_manager.rs | components/workspace/ | PTY lifecycle, grid layout |
| Git | core/git_manager.rs | components/drawer/ | Worktrees, diffs, merges |
| Cost | core/cost_tracker.rs | components/drawer/ | Token/cost parsing per agent |
| Sidebar | — | components/sidebar/ | Project, skills, MCP, config |
| Review | core/review_store.rs | components/review/ | Diff viewer, comments |

## Conventions
See .synk/standards.md for full project standards.
- Components: PascalCase, <200 lines, composition over inheritance
- Rust modules: snake_case, Result<T,E> for fallible ops, no unwrap()
- IPC: one command file per domain, invoke wrappers in src/lib/tauri-api.ts
- Types: centralized in src/lib/types.ts

## Documentation
- docs/ARCHITECTURE.md — Architecture layers and dependencies
- docs/SYNK_BUILD_GUIDE.md — Original 38-task build guide
- docs/plans/ — Feature specs and design plans
- docs/design-docs/ — Architecture decision records
- docs/product-specs/ — Feature specifications
- docs/references/ — Dependency context files

## Current State
- Phases 1-3 complete (sessions, sidebar, git)
- Phase 4-5 archived (orchestration, brainstorm wizard)
- Phase 6 in progress (polish: cost tracking, command bar, notifications)
- See docs/exec-plans/active/ for current work

## Codebase Layout
(tree diagram maintained per global CLAUDE.md instructions)
```

---

## Implementation Steps

1. Create `.claude/` directory and `CLAUDE.md`
2. Create `docs/design-docs/`, `docs/exec-plans/`, `docs/product-specs/`, `docs/references/`
3. Create `docs/design-docs/index.md` with catalog template
4. Create `docs/product-specs/index.md` with catalog template
5. Create `docs/ARCHITECTURE.md` with module map
6. Create `docs/exec-plans/active/` and `docs/exec-plans/completed/`
7. Create `docs/exec-plans/tech-debt-tracker.md` with initial inventory
8. Generate reference docs for key dependencies (Tauri v2, xterm.js, Zustand)
9. Create `docs/QUALITY_SCORE.md` with initial grades per module

---

## Success Criteria

- [ ] New Claude session in Synk repo gets useful context in first 100 lines
- [ ] CLAUDE.md contains no implementation details — only pointers
- [ ] All docs/ subdirectories have at least an index.md
- [ ] Reference docs cover the top 3-5 dependencies
- [ ] Architecture map accurately reflects current codebase structure
- [ ] Quality scores provide honest grades for each module
