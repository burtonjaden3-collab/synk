# TASK 5B.4: Floating Mermaid Planner (Frontend)
> Phase 5 — Brainstorm Wizard | Session B (Frontend) | Depends on: Task 5B.2, Task 5B.3 (task system)

## What to Build
Toggleable floating panel for existing projects (not the wizard). Shows the system architecture diagram with live node status. Right-click nodes to link them to tasks from the simple task system.

## Changed from Original Spec
- **Orchestrator events removed**: Node status updates come from reading `.synk/tasks.json` (simple task system from Task 5B.3), not from orchestrator events. Status is refreshed on panel open and when tasks are updated.
- **Task queue source changed**: "Link to task" picks from `.synk/tasks.json` tasks, not an orchestrator task queue.
- **Hotkey changed**: Uses `m` key (mnemonic for "mermaid/map") instead of `b`. The `b` key is a common vim motion (word backward) and could conflict if vim navigation expands.

## Features
- Toggle with `m` key (in navigation mode) or sidebar button
- Floating, draggable, resizable panel on top of workspace
- Shows system architecture Mermaid diagram from `.synk/blueprint.json`
- Nodes colored by status: gray (not started), blue (in progress), green (done), red (error)
- Right-click a node -> "Link to task" -> pick from `.synk/tasks.json` task list
- Right-click context menu: "Link to task", "Set status", "Unlink"
- Node status refreshed from task system on panel open + after task updates

## Node Status Model

```typescript
interface MermaidNodeBinding {
  nodeId: string;          // "auth-service" from the diagram
  taskId: string | null;   // linked task ID from .synk/tasks.json
  status: 'not_started' | 'in_progress' | 'done' | 'failed';
}
```

Bindings are stored in `.synk/blueprint.json` under the `bindings` array:
```json
{
  "bindings": [
    { "nodeId": "auth-service", "taskId": "uuid-1", "status": "in_progress" },
    { "nodeId": "user-dashboard", "taskId": "uuid-2", "status": "not_started" }
  ]
}
```

## Status Resolution
When the floating planner opens or refreshes:
1. Read `bindings` from `.synk/blueprint.json`
2. For each binding with a `taskId`, read the task status from `.synk/tasks.json`
3. Map task status to node status: `queued` -> `not_started`, `in_progress` -> `in_progress`, `done` -> `done`, `failed` -> `failed`
4. For unlinked nodes (no taskId): show as `not_started`
5. Apply CSS classes to Mermaid SVG nodes

## Node Status Styling
Applied via CSS classes on the rendered Mermaid SVG:
- `not_started`: default styling (gray border)
- `in_progress`: pulsing blue border
- `done`: green border + checkmark overlay
- `failed`: red border + x overlay

## Context Menu
Right-click on a Mermaid node shows:
1. **Link to task** -> opens a dropdown/popover listing tasks from `.synk/tasks.json`. Selecting a task creates a binding.
2. **Set status** -> manually set status without linking (for nodes that don't map to a single task)
3. **Unlink** -> remove the binding (if linked)

Binding changes save immediately to `.synk/blueprint.json`.

## Deliverables
1. `MermaidFloatingPanel.tsx` — floating draggable panel with Mermaid rendering
2. Live status overlay: color nodes based on linked task status
3. Right-click context menu on nodes: "Link to task", "Set status", "Unlink"
4. Reads from `.synk/blueprint.json` (diagram source + bindings)
5. Reads from `.synk/tasks.json` for task status resolution
6. `m` key handler added to keybindings.ts

## Files to Create/Modify
```
src/components/planner/MermaidFloatingPanel.tsx (populate — currently empty)
src/lib/keybindings.ts                         (add 'm' key handler for planner toggle)
src/lib/store.ts                               (add plannerOpen state)
src/components/workspace/Workspace.tsx          (render floating panel when open)
```

## Acceptance Test
Press `m` in navigation mode -> floating panel appears with architecture diagram from `.synk/blueprint.json`. All nodes show gray (not_started). Right-click a node -> "Link to task" -> select a task from `.synk/tasks.json` -> node turns blue (in_progress) or green (done) based on task status. Drag/resize panel works. Press `m` again -> panel closes. Bindings persist in `.synk/blueprint.json` across panel open/close.
