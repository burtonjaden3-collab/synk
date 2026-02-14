# Synk Vault — Obsidian-Inspired Knowledge System

**Priority:** 0 (Foundational — enables and enhances priorities 1-9)
**Inspired by:** Obsidian's vault/graph/backlink model + OpenAI Harness "repo as system of record"
**Status:** Spec

---

## Overview

Synk Vault is a native knowledge management system built into Synk. It solves the critical problem that **every agent session generates valuable knowledge — decisions, patterns, debugging approaches, architecture rationale — and it all evaporates when the session ends.**

The vault is Obsidian-inspired but purpose-built for AI agent workflows:

- **Session Journals** — Auto-generated rich summaries when sessions end
- **Knowledge Graph** — Visual interactive graph showing connections between notes, sessions, projects, and modules
- **Agent Memory** — When starting a session, Synk auto-injects relevant vault context so agents have memory across sessions
- **Cross-Project Knowledge** — Global vault spans projects; useful knowledge can be promoted from project to global
- **Manual Notes** — Full markdown editor for design decisions, ideas, reference docs, and personal notes
- **Hybrid Search** — Tag matching for exact hits + semantic embeddings for conceptual search

The vault lives as plain markdown files — compatible with Obsidian, VS Code, or any markdown tool.

---

## Architecture

### Vault Layers

```
~/.synk/vault/                      # GLOBAL vault (cross-project)
├── notes/                          # Manual notes
├── patterns/                       # Promoted cross-project patterns
├── snippets/                       # Reusable code snippets
├── config.json                     # Global vault settings
└── index.json                      # Search index + embeddings cache

<project>/.synk/vault/              # PROJECT vault (per-project)
├── journals/                       # Auto-generated session journals
│   ├── 2026-02-13-session-abc.md
│   └── ...
├── decisions/                      # Design decision records
├── modules/                        # Per-module knowledge
│   ├── session-manager.md
│   ├── cost-tracker.md
│   └── ...
├── notes/                          # Manual project notes
├── bugs/                           # Bug investigation records
├── config.json                     # Project vault settings
└── index.json                      # Search index + embeddings cache
```

### Note Format

Every vault note is a standard markdown file with YAML frontmatter:

```markdown
---
id: note-2026-02-13-abc123
type: journal | decision | module | note | pattern | bug | snippet
title: Refactored cost tracker to support Gemini output format
created: 2026-02-13T14:30:00Z
updated: 2026-02-13T14:30:00Z
tags: [cost-tracking, gemini, regex, parsing]
links: [session-manager, cost-tracker]
files: [src-tauri/src/core/cost_tracker.rs, src/components/drawer/CostPanel.tsx]
project: synk
session: session-abc123
agent: claude-code
promoted: false
---

# Refactored cost tracker to support Gemini output format

## Summary
Added regex patterns for Gemini CLI output parsing...

## Decisions
- Chose regex over structured parsing because [[decision-parsing-strategy|Gemini output is unstructured]]
- Added fallback to [[module-cost-tracker|MCP-based cost reporting]] when regex fails

## Files Changed
- `src-tauri/src/core/cost_tracker.rs` — Added GeminiPattern struct
- `src/components/drawer/CostPanel.tsx` — Updated display for multi-model costs

## Open Questions
- Should we support Gemini's streaming cost updates? See [[note-streaming-costs]]
```

Key features of the format:
- `[[backlinks]]` use Obsidian-compatible wiki-link syntax
- `tags` enable fast keyword search
- `files` enable file-based context matching for Agent Memory
- `links` define explicit graph connections
- `promoted` flag indicates if note has been promoted to global vault

---

## Feature 1: Session Journals

### How It Works

1. Session runs normally — user works with an agent
2. When the session ends (user closes it, or agent completes), Synk triggers journal generation
3. Synk collects session metadata:
   - Agent type and model used
   - Duration and cost (from cost tracker)
   - Files modified (from git diff of the session's worktree/branch)
   - Git commits made during the session
   - Terminal output (last N lines, filtered for signal)
4. Synk sends a structured prompt to a lightweight agent (or the session's own agent before it closes):
   ```
   Summarize this coding session as a knowledge note. Include:
   - What was the goal?
   - What approach was taken?
   - What key decisions were made and why?
   - What problems were encountered?
   - What was the outcome?
   - Any open questions or follow-up work?

   Session metadata:
   {metadata}

   Recent terminal output:
   {last_500_lines}

   Files changed:
   {git_diff_stat}
   ```
5. The generated summary is saved as a journal note in `.synk/vault/journals/`
6. Synk auto-generates backlinks based on:
   - File paths mentioned → link to module notes
   - Concepts mentioned → link to existing decision/pattern notes
   - Project → link to project note
7. The search index is updated with the new note's tags and embeddings

### Journal Note Template

```markdown
---
id: journal-2026-02-13-session-abc123
type: journal
title: [Auto-generated title from summary]
created: 2026-02-13T16:45:00Z
tags: [auto-extracted-tags]
files: [list-of-changed-files]
project: synk
session: session-abc123
agent: claude-code
model: claude-opus-4-6
duration_minutes: 47
cost_usd: 2.34
commits: [abc1234, def5678]
---

# [Auto-generated title]

## Goal
[What the user was trying to accomplish]

## Approach
[What strategy was taken]

## Key Decisions
- [Decision 1] — because [rationale]
- [Decision 2] — because [rationale]

## Problems Encountered
- [Problem] — resolved by [solution]

## Outcome
[What was accomplished]

## Files Changed
- `path/to/file.rs` — [brief description of change]

## Open Questions
- [Any unresolved questions or follow-up work]

## Related
- [[module-name]] — module that was modified
- [[previous-journal]] — related previous session
```

### Configuration

```ts
type JournalConfig = {
  autoGenerate: boolean;            // Generate journal on session end (default true)
  promptBeforeGenerating: boolean;  // Ask user before generating (default false)
  includeTerminalOutput: boolean;   // Include terminal excerpt in metadata (default true)
  terminalOutputLines: number;      // How many lines to include (default 500)
  summaryModel: string | null;      // Model to use for summarization (null = use session's model)
};
```

---

## Feature 2: Knowledge Graph

### Visual Graph View

An interactive node-and-edge graph rendered in the Vault drawer tab:

- **Nodes** represent notes (journals, decisions, modules, manual notes, patterns)
- **Edges** represent `[[backlinks]]` between notes
- **Node types** are visually distinct:
  - Journals: blue circles
  - Decisions: orange diamonds
  - Module notes: green squares
  - Manual notes: gray circles
  - Patterns (global): purple stars
  - Bugs: red triangles
- **Node size** scales with the number of connections (more connected = larger)
- **Clustering** — notes about the same module or topic cluster together
- **Interaction:**
  - Click a node to preview the note in a side panel
  - Double-click to open the note for editing
  - Drag to rearrange
  - Zoom and pan
  - Filter by note type, tags, date range, project
  - Search highlights matching nodes

### Implementation

- Use a lightweight graph rendering library:
  - **Option A:** `d3-force` — full control, well-known, good for custom layouts
  - **Option B:** `react-force-graph` — React wrapper around d3-force, less boilerplate
  - **Option C:** `vis-network` — feature-rich, good performance for 1000+ nodes
- Recommendation: `react-force-graph` for fast implementation with good defaults
- Graph data is computed from the vault's `[[backlink]]` relationships
- Rebuild graph index on vault changes (debounced)

### Backlink System

- When viewing any note, a "Backlinks" section at the bottom shows all notes that reference this note
- Backlinks are bidirectional — if Note A links to Note B, Note B's backlinks section shows Note A
- Backlinks are computed from `[[wiki-link]]` syntax in note content + `links` frontmatter array
- Backlink index is maintained in `index.json` and updated on note save

### Data Model

```ts
type VaultGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type GraphNode = {
  id: string;                        // Note ID
  label: string;                     // Note title
  type: NoteType;
  tags: string[];
  createdAt: string;
  connectionCount: number;           // Number of edges
  project: string | 'global';
};

type GraphEdge = {
  source: string;                    // Source note ID
  target: string;                    // Target note ID
  label: string | null;              // Optional edge label
};

type NoteType = 'journal' | 'decision' | 'module' | 'note' | 'pattern' | 'bug' | 'snippet';
```

---

## Feature 3: Agent Memory

### How It Works

When a new session starts, Synk performs a **context retrieval** step:

1. **Collect signals** about what this session will work on:
   - Project currently open
   - Files visible in the workspace / recently accessed
   - Session prompt (if user typed an initial task)
   - Agent type being used
2. **Query the vault** using hybrid search:
   - **Tag matching:** Find notes tagged with relevant file paths, module names, or topics
   - **Semantic search:** Embed the session's initial context and find notes with similar embeddings
   - **Recency boost:** Weight recent notes higher than old ones
   - **Relevance scoring:** Combine tag match score + semantic similarity + recency
3. **Select top-K notes** (configurable, default 3-5) that are most relevant
4. **Inject as context preamble** into the session's PTY:
   ```
   [Synk Memory] Relevant context from previous sessions:

   --- Session: "Refactored cost tracker" (2 days ago) ---
   Added Gemini output parsing. Key decision: regex over structured parsing.
   Open question: streaming cost updates not yet supported.
   Files: cost_tracker.rs, CostPanel.tsx

   --- Decision: "Parsing Strategy" ---
   We validate data at boundaries. For unstructured agent output, use regex
   with fallback to MCP-based reporting.

   --- Module: cost-tracker ---
   Handles token/cost extraction from Claude, Gemini, and Codex output.
   Known issue: Codex cost format changed in v2.1.
   ---
   ```
5. The injection is **visible in the UI** — a small "Memory" indicator on the session shows what was injected, and the user can expand it to see/modify

### Hybrid Search Engine

```ts
type SearchQuery = {
  text: string;                      // Natural language query or keywords
  filePaths: string[];               // File paths for tag matching
  tags: string[];                    // Explicit tags to match
  project: string | 'all';          // Scope to project or search globally
  maxResults: number;                // Default 5
  recencyBoostDays: number;          // Notes within this window get boosted (default 14)
};

type SearchResult = {
  noteId: string;
  title: string;
  type: NoteType;
  score: number;                     // Combined relevance score (0-1)
  matchType: 'tag' | 'semantic' | 'both';
  excerpt: string;                   // Relevant excerpt from the note
  createdAt: string;
};
```

### Embedding Strategy

- Use a local embedding model for privacy and speed:
  - **Option A:** `all-MiniLM-L6-v2` via ONNX runtime in Rust — fast, small (80MB), good quality
  - **Option B:** Call the configured AI provider's embedding API (OpenAI, Anthropic) — better quality, requires API calls
  - **Option C:** Hybrid — local model for initial indexing, API model for search-time queries
- Recommendation: Start with Option B (API embeddings) since users already have API keys configured. Add local model later for offline support.
- Embeddings are cached in `index.json` and re-computed only when notes change
- Each note is embedded as: `title + tags + first 500 chars of content`

### Backend: `src-tauri/src/core/vault_search.rs`

- `VaultSearch` struct:
  - Maintains tag index (inverted index: tag → list of note IDs)
  - Maintains embedding index (note ID → embedding vector)
  - Cosine similarity search for semantic matching
- `search(query: SearchQuery) -> Vec<SearchResult>`
  - Run tag matching → get candidates with tag scores
  - Run semantic search → get candidates with similarity scores
  - Merge and rank by combined score with recency boost
  - Return top-K results
- `index_note(note_id, content, tags, file_paths)`
  - Update tag index
  - Compute and cache embedding
- `remove_note(note_id)` — remove from indices
- `rebuild_index()` — full re-index of vault

---

## Feature 4: Cross-Project Knowledge

### Project vs Global Vault

| Aspect | Project Vault | Global Vault |
|--------|--------------|-------------|
| Location | `.synk/vault/` in project root | `~/.synk/vault/` |
| Content | Session journals, module notes, project decisions | Patterns, snippets, cross-project learnings |
| Scope | Searched when working in this project | Searched across all projects |
| Auto-populated | Yes (session journals) | Only via promotion |
| Git tracked | Yes (committed with project) | No (personal knowledge) |

### Promotion Flow

1. User views a session journal or note in the project vault
2. User clicks **"Promote to Global"** button
3. Synk creates a copy in `~/.synk/vault/patterns/` (or appropriate subdirectory)
4. The copy is tagged with the source project
5. The original note gets a `promoted: true` flag and a backlink to the global copy
6. Global note is now searchable from any project

### Agent Context Injection Priority

When injecting memory into a session:
1. **First:** Search project vault (highest relevance)
2. **Then:** Search global vault (cross-project patterns)
3. **Merge and rank** by combined score
4. **Inject top-K** (deduplicated)

---

## Feature 5: Manual Notes & Markdown Editor

### Built-in Markdown Editor

The Vault drawer tab includes a markdown editor for creating and editing notes:

- **Toolbar:** Bold, italic, headings, code blocks, links, `[[backlink]]` autocomplete
- **`[[` autocomplete:** When user types `[[`, show a dropdown of existing notes to link to
- **Live preview:** Side-by-side or toggle between edit and preview modes
- **Frontmatter editor:** Structured form for editing tags, type, links (don't make users write YAML)
- **Templates:** Quick-create templates for common note types:
  - Design Decision
  - Bug Investigation
  - Module Overview
  - Code Pattern
  - Meeting Notes / Brainstorm

### Note Types & Templates

#### Design Decision

```markdown
---
type: decision
title: [Decision Title]
tags: []
status: proposed | accepted | superseded
---

# [Decision Title]

## Context
[What prompted this decision?]

## Options Considered
1. **Option A** — [description, pros, cons]
2. **Option B** — [description, pros, cons]

## Decision
[What was decided and why]

## Consequences
[What changes as a result of this decision]
```

#### Bug Investigation

```markdown
---
type: bug
title: [Bug Title]
tags: []
status: investigating | identified | resolved
severity: low | medium | high | critical
---

# [Bug Title]

## Symptoms
[What's happening]

## Reproduction
[Steps to reproduce]

## Root Cause
[What's causing it]

## Fix
[How it was fixed]

## Prevention
[How to prevent similar bugs]
```

#### Module Overview

```markdown
---
type: module
title: [Module Name]
tags: []
files: [key file paths]
---

# [Module Name]

## Purpose
[What this module does]

## Key Files
- `path/to/main.rs` — [role]

## Dependencies
- Depends on: [[other-module]]
- Depended on by: [[consuming-module]]

## Known Issues
- [Issue 1]

## History
- [[journal-xyz]] — Last session that modified this
```

---

## Feature 6: Vault UI (Drawer Tab)

### Layout

The "Vault" drawer tab has three sub-views, switchable via segmented control:

#### 1. Notes View (default)
- **Search bar** at the top with full-text search
- **Filter chips:** By type (journal, decision, module, note, pattern, bug), by tags, by date range
- **Note list:** Sorted by most recent, showing:
  - Type icon + title
  - Tags as small pills
  - Date + excerpt
  - Connection count badge
- **Click a note** → opens in a reading/editing panel (slides in from right or replaces the list)
- **"New Note" button** with template picker

#### 2. Graph View
- Full interactive knowledge graph (see Feature 2)
- Takes the full drawer width/height
- Minimap in corner for navigation
- Filter controls overlay

#### 3. Memory View
- Shows what Agent Memory has injected into each active session
- Per-session card showing:
  - Session name
  - List of injected notes (clickable)
  - "Refresh Memory" button to re-query
  - "Add Note" button to manually inject a specific note

### Vault Stats (shown in all views)
- Small status bar at bottom: "47 notes · 12 journals · 8 decisions · 3 patterns · Last indexed 2m ago"

---

## Data Model Summary

### Core Types

```ts
type VaultNote = {
  id: string;                        // UUID
  type: NoteType;
  title: string;
  content: string;                   // Raw markdown content
  tags: string[];
  files: string[];                   // Referenced file paths
  links: string[];                   // Explicit links to other note IDs
  backlinks: string[];               // Computed: notes that link TO this note
  project: string | 'global';
  session: string | null;            // Source session ID (for journals)
  agent: string | null;              // Agent type (for journals)
  promoted: boolean;
  createdAt: string;
  updatedAt: string;
  filePath: string;                  // Actual file path on disk
};

type Vault = {
  project: string;
  projectPath: string;              // .synk/vault/ path
  globalPath: string;               // ~/.synk/vault/ path
  notes: VaultNote[];               // All notes (project + global)
  graph: VaultGraph;                // Computed graph structure
  searchIndex: SearchIndex;         // Tag + embedding index
  config: VaultConfig;
};

type VaultConfig = {
  journalConfig: JournalConfig;
  memoryConfig: MemoryConfig;
  searchConfig: SearchConfig;
};

type MemoryConfig = {
  autoInject: boolean;               // Auto-inject on session start (default true)
  maxNotesInjected: number;          // Max notes to inject (default 5)
  recencyBoostDays: number;          // Recency window (default 14)
  includeGlobalVault: boolean;       // Search global vault too (default true)
  showInjectedNotes: boolean;        // Show what was injected in UI (default true)
};

type SearchConfig = {
  embeddingProvider: 'api' | 'local'; // Which embedding model to use
  embeddingModel: string;            // Specific model ID
  tagWeight: number;                 // Weight for tag matching (default 0.4)
  semanticWeight: number;            // Weight for semantic search (default 0.4)
  recencyWeight: number;             // Weight for recency (default 0.2)
};
```

---

## Backend Changes (Rust)

### New modules

| Module | Purpose |
|--------|---------|
| `src-tauri/src/core/vault.rs` | Vault lifecycle — init, load, save, watch for changes |
| `src-tauri/src/core/vault_notes.rs` | CRUD operations on notes, frontmatter parsing |
| `src-tauri/src/core/vault_journal.rs` | Session journal generation — metadata collection, summary prompting |
| `src-tauri/src/core/vault_graph.rs` | Graph computation — backlink resolution, node/edge generation |
| `src-tauri/src/core/vault_search.rs` | Hybrid search engine — tag index, embeddings, ranking |
| `src-tauri/src/core/vault_memory.rs` | Agent memory — context retrieval, injection formatting |

### New command file: `src-tauri/src/commands/vault.rs`

- `init_vault` — initialize vault directories for a project
- `list_vault_notes` — list notes with filtering
- `get_vault_note` — get full note content
- `create_vault_note` — create a new note
- `update_vault_note` — update note content
- `delete_vault_note` — delete a note
- `search_vault` — hybrid search
- `get_vault_graph` — get graph data for visualization
- `generate_session_journal` — trigger journal generation for a session
- `get_agent_memory` — get memory context for a session
- `promote_note_to_global` — copy note to global vault
- `rebuild_vault_index` — full re-index

### Integration Points

- **SessionManager:** On session end → trigger journal generation
- **CostTracker:** Provide cost data for journal metadata
- **GitManager:** Provide diff/commit data for journal metadata
- **ProcessPool:** On session start → query agent memory, inject context preamble

---

## Frontend Changes

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `VaultDrawerTab` | `src/components/drawer/` | Main vault drawer tab with sub-views |
| `NotesList` | `src/components/vault/` | Filterable, searchable notes list |
| `NoteEditor` | `src/components/vault/` | Markdown editor with `[[` autocomplete |
| `NoteViewer` | `src/components/vault/` | Rendered markdown view with backlinks |
| `VaultGraph` | `src/components/vault/` | Interactive knowledge graph visualization |
| `MemoryView` | `src/components/vault/` | Shows injected memory per session |
| `VaultSearch` | `src/components/vault/` | Search bar with filters |
| `PromoteButton` | `src/components/vault/` | "Promote to Global" action button |
| `JournalPreview` | `src/components/vault/` | Preview card for auto-generated journals |

### Zustand Store Extensions

```ts
// Add to existing store or create vault slice
type VaultSlice = {
  notes: VaultNote[];
  graph: VaultGraph;
  selectedNote: VaultNote | null;
  searchQuery: string;
  searchResults: SearchResult[];
  activeFilters: NoteFilter;
  vaultView: 'notes' | 'graph' | 'memory';
  memoryBySession: Record<string, SearchResult[]>; // session ID → injected notes
};
```

### Session Header Integration

- Sessions with memory injected show a small brain/memory icon
- Clicking the icon shows a tooltip/popover listing injected notes
- Each note is clickable → opens in vault drawer

---

## Dependencies on Other Specs

| Spec | Relationship |
|------|-------------|
| Agent Review Loops (#1) | Review results could generate vault notes (decision records) |
| Quality Score (#3) | Score changes could auto-generate notes explaining what changed |
| Execution Plan Tracker (#4) | Plans are a type of vault note (or linked to vault notes) |
| Project Standards (#5) | Standards could be a vault note type with special treatment |
| Doc Freshness (#6) | Vault notes should be included in freshness checks |
| Scheduled Tasks (#8) | Could schedule periodic vault maintenance (re-index, clean orphans) |
| Knowledge Base (#9) | Vault subsumes/replaces some of the docs/ knowledge base function |

---

## Edge Cases

- Session ends abruptly (crash) — generate journal from available metadata, mark as "incomplete"
- Vault gets very large (1000+ notes) — paginate note list, lazy-load graph, limit search results
- Embedding API unavailable — fall back to tag-only search, queue embeddings for later
- Conflicting backlinks (note renamed) — update all backlinks in linked notes
- User deletes vault files externally — detect on next scan, update index gracefully
- Duplicate promotion — warn if a very similar note already exists in global vault
- Multiple projects open — each has its own vault context, but global vault shared
- No session prompt (user just opens a terminal) — memory injection uses project + recent files only
- Journal generation fails (model error) — save a minimal journal with metadata only, flag for retry

---

## Implementation Phases

This is a large feature. Recommended build order:

### Phase A: Foundation
1. Vault directory structure and initialization
2. Note CRUD (create, read, update, delete)
3. Frontmatter parsing
4. Basic notes list in drawer tab
5. Simple markdown viewer

### Phase B: Journals
6. Session metadata collection on session end
7. Journal generation via agent prompt
8. Auto-save journals to vault
9. Journal display in notes list

### Phase C: Search & Memory
10. Tag index construction
11. Tag-based search
12. Embedding computation and caching
13. Semantic search
14. Hybrid search ranking
15. Agent memory injection on session start
16. Memory view in drawer

### Phase D: Graph & Polish
17. Backlink resolution
18. Graph data computation
19. Interactive graph visualization
20. Markdown editor with `[[` autocomplete
21. Note templates
22. Cross-project vault + promotion
23. Settings and configuration UI

---

## Success Criteria

- [ ] Session journals are auto-generated within 30 seconds of session end
- [ ] Journals capture meaningful summaries (not just file lists)
- [ ] Vault search returns relevant results in <500ms
- [ ] Agent memory injection adds useful context that improves session outcomes
- [ ] Knowledge graph renders smoothly with 500+ nodes
- [ ] Backlinks are bidirectional and update automatically
- [ ] Manual note creation is fast and natural (markdown editor works well)
- [ ] Cross-project knowledge is discoverable from any project
- [ ] Vault files are standard markdown, openable in Obsidian/VS Code/any editor
- [ ] Vault survives app crashes, restarts, and project moves
