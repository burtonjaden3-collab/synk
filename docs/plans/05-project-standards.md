# Project Standards / Golden Principles

**Priority:** 5
**Inspired by:** OpenAI Harness Engineering — mechanical rules enforced continuously
**Status:** Spec

---

## Overview

Add a project standards system where users define coding conventions, architecture constraints, and quality rules per project. Standards are stored in `.synk/standards.md` (human-readable, agent-readable) and surfaced in a sidebar panel. Agents can reference standards during code generation and review.

Standards feed into the Quality Score (priority 3) and Agent Review Loops (priority 1).

---

## Decisions

| Question | Answer |
|----------|--------|
| Where do standards live? | `.synk/standards.md` in project root |
| Format | Structured markdown with categories |
| Where is the UI? | Sidebar panel (new tab) or Settings sub-section |
| Can agents read them? | Yes — standards file path is referenced in CLAUDE.md / AGENTS.md |
| Validation | Standards are aspirational — Synk doesn't lint, but agents use them for review |
| Templates | Provide starter templates for common stacks (React+Tauri, Node, Python, etc.) |

---

## Standards File Format

```markdown
# Project Standards

## Naming Conventions
- React components: PascalCase (e.g., `SessionGrid`, `HomeScreen`)
- Rust modules: snake_case (e.g., `session_manager`, `cost_tracker`)
- TypeScript types: PascalCase with descriptive names (e.g., `SessionConfig`, `AgentType`)
- CSS classes: kebab-case with component prefix (e.g., `session-grid-container`)
- File names: match the primary export (e.g., `SessionGrid.tsx` exports `SessionGrid`)

## Architecture Rules
- Frontend state management: Zustand only, no prop drilling beyond 2 levels
- Backend modules: each domain gets its own module in `src-tauri/src/core/`
- IPC commands: one command file per domain in `src-tauri/src/commands/`
- No direct filesystem access from frontend — all through Tauri IPC
- Dependencies flow inward: UI → Store → Tauri API → Core modules

## Code Quality
- Max file length: 500 lines (split if larger)
- Max function length: 50 lines
- All public Rust functions must return Result<T, E> for fallible operations
- No unwrap() in production code — use ? operator or proper error handling
- TypeScript: strict mode, no `any` types except at FFI boundaries

## Testing
- New features require at least one test file
- Test files colocated with source: `foo.rs` → `foo_test.rs`, `Foo.tsx` → `Foo.test.tsx`
- Integration tests in `tests/` directory

## Documentation
- Each core module has a doc comment explaining its purpose
- Complex logic gets inline comments explaining "why", not "what"
- Public API changes require updating relevant docs/ files

## Patterns to Prefer
- Composition over inheritance
- Small, focused components (<200 lines)
- Explicit error handling over silent failures
- Structured logging with context fields

## Patterns to Avoid
- God components (components doing too many things)
- Deeply nested callbacks (use async/await)
- Magic strings (use constants or enums)
- Direct DOM manipulation in React (use refs or state)
```

---

## Data Model

### New type: `ProjectStandards`

```ts
type ProjectStandards = {
  filePath: string;                  // Path to standards.md
  lastModified: string;              // ISO timestamp
  categories: StandardsCategory[];
  raw: string;                       // Full markdown content
};

type StandardsCategory = {
  name: string;                      // e.g., "Naming Conventions"
  rules: string[];                   // Individual rules extracted from list items
};

type StandardsTemplate = {
  id: string;                        // e.g., "react-tauri", "node-api", "python"
  name: string;                      // Display name
  description: string;
  content: string;                   // Markdown template content
};
```

---

## Backend Changes (Rust)

### New module: `src-tauri/src/core/standards.rs`

- `load_standards(project_path) -> Option<ProjectStandards>`
  - Reads `.synk/standards.md`, parses categories from headings
- `save_standards(project_path, content)`
  - Writes to `.synk/standards.md`, creates `.synk/` if needed
- `get_templates() -> Vec<StandardsTemplate>`
  - Returns built-in starter templates
- `create_from_template(project_path, template_id)`
  - Creates standards file from a template
- `get_standards_summary(project_path) -> String`
  - Returns a concise summary suitable for injecting into agent prompts
  - Used by Agent Review (priority 1) and session context injection

### New commands: `src-tauri/src/commands/standards.rs`

- `get_project_standards` — returns parsed standards or null
- `save_project_standards` — save updated standards content
- `list_standards_templates` — returns available templates
- `create_standards_from_template` — initialize from template
- `get_standards_for_agent` — returns summary formatted for agent context

---

## Frontend Changes

### Sidebar Tab: "Standards"

- **If no standards file exists:**
  - "No project standards configured" message
  - "Create Standards" button
  - Template picker: cards for each template (React+Tauri, Node API, Python, Generic)
  - "Start from Blank" option

- **If standards file exists:**
  - Rendered markdown view of the standards
  - "Edit" button — opens an inline markdown editor
  - Category navigation — clickable headings for quick scroll
  - Last modified timestamp
  - "Regenerate from template" option (with confirmation)

### Integration Points

- **Agent Review (priority 1):** When requesting an agent review, standards are automatically included in the review prompt
- **Quality Score (priority 3):** Standards rules inform the architecture and code quality criteria
- **Session Context:** Optional — when creating a new session, include standards summary in the initial context
- **Onboarding:** After first project setup, suggest creating project standards

---

## Built-in Templates

### React + Tauri (default for Synk-like projects)
- Component conventions, Zustand patterns, IPC rules, Rust module structure

### Node.js API
- Express/Fastify patterns, middleware conventions, error handling, DB access rules

### Python
- PEP 8 adherence, type hints, docstring format, test conventions

### Generic
- Minimal set: naming, file size limits, testing expectations, documentation

---

## Edge Cases

- Standards file edited externally — file watcher picks up changes, re-renders in sidebar
- Standards file is very long — add collapsible sections per category
- No `.synk/` directory — create it when saving standards
- Multiple team members with different preferences — standards file is versioned in git, standard conflict resolution applies
- Agent ignores a standard — track this as a quality score issue, surface in review

---

## Success Criteria

- [ ] Creating standards from a template takes <10 seconds
- [ ] Standards are readable in the sidebar without scrolling for typical configs
- [ ] Agent review prompts automatically include relevant standards
- [ ] Standards file is valid markdown that works in any viewer (GitHub, VS Code, etc.)
- [ ] Editing standards from the UI updates the file immediately
- [ ] At least 4 templates are available covering common stacks
