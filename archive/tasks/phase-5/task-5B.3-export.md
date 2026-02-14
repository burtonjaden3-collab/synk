# TASK 5B.3: Export Panel + Task System (Frontend)
> Phase 5 — Brainstorm Wizard | Session B (Frontend) | Depends on: Task 5B.2, Task 5A.2

## What to Build
Export panel with all export options. Simple task system for manual-mode project management. Scaffold project directories. Generate CLAUDE.md.

## Changed from Original Spec
- **Gastown convoy export removed**: Phase 4 (orchestration/Gastown) was archived. All `bd create`, `gt convoy create`, `bd link` logic has been removed entirely.
- **Simple task system added**: A lightweight `.synk/tasks.json` file with Tauri CRUD commands replaces the orchestrator's task queue. This enables the floating planner (Task 5B.4) to link diagram nodes to tasks.
- **Export options simplified**: Four exports: scaffold directory, CLAUDE.md, local task list, copy as markdown.

## Export Options
1. **Scaffold directory** — create project folder with boilerplate files based on tech stack
2. **Export to CLAUDE.md** — generate the context file (calls backend from Task 5A.2)
3. **Export to task list** — AI generates tasks from architecture diagram, saves to `.synk/tasks.json`
4. **Copy as markdown** — copy all diagrams + extracted data as markdown to clipboard

## Simple Task System

### Data Model
```typescript
interface SynkTask {
  id: string;                // uuid
  title: string;             // e.g. "Build Auth Service"
  description: string;       // 2-3 sentences
  status: 'queued' | 'in_progress' | 'done' | 'failed';
  nodeId?: string | null;    // linked Mermaid node ID from architecture diagram
  branch?: string | null;    // git branch name
  dependencies: string[];    // task IDs that must complete first
  complexity: 'small' | 'medium' | 'large';
  createdAt: string;         // RFC3339
  updatedAt: string;         // RFC3339
}
```

### Storage
Tasks are stored in `.synk/tasks.json` per-project:
```json
{
  "version": 1,
  "tasks": [
    {
      "id": "uuid-1",
      "title": "Build Auth Service",
      "description": "Implement JWT-based auth with login/signup endpoints.",
      "status": "queued",
      "nodeId": "auth-service",
      "branch": "feat/auth-service",
      "dependencies": ["uuid-3"],
      "complexity": "medium",
      "createdAt": "2026-02-10T...",
      "updatedAt": "2026-02-10T..."
    }
  ]
}
```

### Tauri Commands (Backend)

```typescript
// List all tasks for a project
invoke('task_list', { args: { projectPath: string } })
  -> SynkTask[]

// Create a new task
invoke('task_create', {
  args: {
    projectPath: string,
    title: string,
    description: string,
    nodeId?: string | null,
    branch?: string | null,
    dependencies?: string[],
    complexity?: 'small' | 'medium' | 'large',
  }
}) -> SynkTask

// Update a task's status (or other fields)
invoke('task_update', {
  args: {
    projectPath: string,
    taskId: string,
    status?: 'queued' | 'in_progress' | 'done' | 'failed',
    title?: string,
    description?: string,
    nodeId?: string | null,
    branch?: string | null,
  }
}) -> SynkTask

// Delete a task
invoke('task_delete', {
  args: { projectPath: string, taskId: string }
}) -> { success: boolean }

// Bulk-create tasks (used by "Export to task list" from blueprint)
invoke('task_bulk_create', {
  args: {
    projectPath: string,
    tasks: Array<{
      title: string,
      description: string,
      nodeId?: string | null,
      branch?: string | null,
      dependencies?: string[],
      complexity?: 'small' | 'medium' | 'large',
    }>
  }
}) -> SynkTask[]
```

### Task Generation from Blueprint
When the user clicks "Export to task list", Synk sends the architecture diagram to the AI with this prompt:

```
Given this architecture diagram, generate a task list for building this project.
For each buildable component, output a JSON object with:
- node_id: the Mermaid node ID this maps to
- title: short task title (imperative verb: "Build...", "Create...", "Set up...")
- description: 2-3 sentences describing what to build
- dependencies: array of node_ids that must be completed first
- estimated_complexity: "small" | "medium" | "large"
- suggested_branch: branch name for this work

Filter out:
- External services (e.g., "Stripe API", "PostgreSQL") — dependencies, not tasks
- Infrastructure nodes (e.g., "Load Balancer", "CDN") — deployment phase
- Grouping nodes (subgraph labels)

Output ONLY a JSON array. No explanation.
```

The frontend parses this response, maps `node_id` to `nodeId` and `suggested_branch` to `branch`, then calls `task_bulk_create`.

## Scaffold Export
Creates the project directory structure based on the file structure diagram and tech stack:
1. Parse the file structure Mermaid diagram for directory/file names
2. Create directories recursively
3. Create placeholder files (empty or with minimal boilerplate based on tech stack)
4. If project directory already exists, skip existing files (don't overwrite)

## CLAUDE.md Export
Calls the backend `claudemd_generate` command from Task 5A.2. The export panel shows a checkbox for this option and calls invoke when checked.

## Markdown Copy
Assembles all diagrams + extracted data (name, description, tech stack, features, entities) into a single markdown document and copies to clipboard using the browser Clipboard API.

## Deliverables
1. `src/components/wizard/ExportPanel.tsx` — export options with checkboxes + "Export" button
2. `src-tauri/src/commands/tasks.rs` — Tauri task CRUD commands
3. `src-tauri/src/core/task_manager.rs` — Task file I/O + CRUD logic
4. `src/lib/tauri-api.ts` — add task CRUD + claudemd wrappers
5. `src/lib/types.ts` — add SynkTask type
6. Scaffold: create directories + placeholder files based on tech stack
7. Task list export: AI generates tasks, bulk-create to `.synk/tasks.json`
8. Success/failure feedback for each export action (toast notifications)

## Files to Create/Modify
```
src/components/wizard/ExportPanel.tsx         (populate — currently empty)
src-tauri/src/commands/tasks.rs               (new)
src-tauri/src/core/task_manager.rs            (new)
src-tauri/src/commands/mod.rs                 (add pub mod tasks)
src-tauri/src/lib.rs                          (register task commands)
src/lib/tauri-api.ts                          (add task + claudemd wrappers)
src/lib/types.ts                              (add SynkTask interface)
```

## Acceptance Test
Select "Scaffold + CLAUDE.md + Task List". Click Export. -> Directory created with files. -> CLAUDE.md generated under 200 lines. -> `.synk/tasks.json` written with tasks linked to diagram nodes. -> Copy as markdown puts full blueprint in clipboard.
