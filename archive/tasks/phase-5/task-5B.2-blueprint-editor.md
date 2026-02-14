# TASK 5B.2: Blueprint Viewer + Editor (Frontend)
> Phase 5 — Brainstorm Wizard | Session B (Frontend) | Depends on: Task 5B.1

## What to Build
Mermaid diagram rendering, code editor, and live preview. All 5 diagram types generated from AI conversation. User can edit diagrams manually.

## Changed from Original Spec
- **`mermaid` npm dependency required**: Must add `mermaid` to package.json before implementation. It is NOT currently installed.
- **Blueprint persistence commands needed**: Need Tauri commands for reading/writing `.synk/blueprint.json`. These don't exist yet and must be added to `commands/persistence.rs`.
- **Orchestrator references removed**: Node status bindings reference the simple task system (Task 5B.3) instead of orchestrator events.

## Prerequisites
Before starting implementation:
1. Run `npm install mermaid` to add Mermaid.js to the project
2. The `.synk/blueprint.json` persistence needs to be wired through Tauri commands

## 5 Diagram Types
1. System Architecture (flowchart TD) — components and data flow
2. File Structure (graph TD) — directory tree
3. Database Schema (erDiagram) — entities and relationships
4. API Routes (flowchart LR) — endpoints and methods
5. Deployment (flowchart TD) — infrastructure layout

## Blueprint Generation Flow
1. User clicks "Generate Blueprint" in the brainstorm wizard (from Task 5B.1)
2. Frontend sends 5 **sequential** AI requests (one per diagram type) using `ai_chat_complete`
3. Each request includes the `ProjectBlueprint` JSON + a diagram-specific system prompt
4. Each response is validated with `mermaid.parse()`
5. If invalid: retry up to 3 times with the error message appended
6. If still invalid after 3 retries: show raw source in editor for manual fixing
7. All 5 diagrams saved to `.synk/blueprint.json`

## Diagram Prompt Templates

**Template 1: System Architecture**
```
Generate a Mermaid flowchart showing the system architecture.

REQUIREMENTS:
- Use `flowchart TD` (top-down layout)
- Group related components with `subgraph` blocks
- Show data flow direction with labeled arrows
- Include: UI components, API layer, business logic, databases,
  caches, message queues, external APIs, auth services
- Node IDs: lowercase-kebab (e.g., auth-service)
- Max 20 nodes (combine minor components)

RESPOND WITH ONLY VALID MERMAID SYNTAX. No markdown fences, no explanation.
```

**Template 2: File/Folder Structure**
```
Generate a Mermaid graph showing the project directory structure as a tree.

REQUIREMENTS:
- Use `graph TD` layout
- Root node = project name
- Depth: max 3 levels deep. Group deeper content as "..."
- Annotate key files with their purpose in parentheses

RESPOND WITH ONLY VALID MERMAID SYNTAX. No markdown fences, no explanation.
```

**Template 3: Database Schema (ER Diagram)**
```
Generate a Mermaid ER diagram showing the database schema.

REQUIREMENTS:
- Use `erDiagram` syntax
- Show relationships with proper cardinality
- Each entity: primary key, foreign keys, 3-7 important fields with types

RESPOND WITH ONLY VALID MERMAID SYNTAX. No markdown fences, no explanation.
```

**Template 4: API Routes**
```
Generate a Mermaid flowchart showing the API route structure.

REQUIREMENTS:
- Use `flowchart LR` (left-to-right layout)
- Group routes by resource with `subgraph` blocks
- Each node = one endpoint: "METHOD /path"

RESPOND WITH ONLY VALID MERMAID SYNTAX. No markdown fences, no explanation.
```

**Template 5: Deployment Architecture**
```
Generate a Mermaid flowchart showing the deployment and infrastructure.

REQUIREMENTS:
- Use `flowchart TD` layout
- Show: developer machine, CI/CD pipeline, staging, production
- Show deployment flow with numbered arrows

RESPOND WITH ONLY VALID MERMAID SYNTAX. No markdown fences, no explanation.
```

## Validation & Error Recovery
1. **Syntax validation**: Run through `mermaid.parse()` on the frontend
2. **If invalid**: Send back to AI: `"The Mermaid syntax had an error: {error}. Fix it and return the corrected version."`
3. **Max 3 retry attempts** before showing raw source in editor for manual fixing
4. **Fallback**: Show a template skeleton the user can fill in manually

## Blueprint Persistence

### `.synk/blueprint.json` Schema
```json
{
  "version": 1,
  "name": "project-name",
  "description": "one-line description",
  "techStack": ["react", "node", "postgres"],
  "features": [{"name": "Auth", "description": "..."}],
  "entities": [{"name": "User", "fields": ["id", "email"]}],
  "diagrams": {
    "architecture": "flowchart TD\n...",
    "fileStructure": "graph TD\n...",
    "database": "erDiagram\n...",
    "apiRoutes": "flowchart LR\n...",
    "deployment": "flowchart TD\n..."
  },
  "bindings": []
}
```

### Tauri Commands Needed
```typescript
// Save blueprint to .synk/blueprint.json
invoke('blueprint_save', {
  args: { projectPath: string, blueprint: BlueprintJson }
}) -> { success: boolean }

// Load blueprint from .synk/blueprint.json
invoke('blueprint_get', {
  args: { projectPath: string }
}) -> BlueprintJson | null
```

These should be added to `commands/persistence.rs` (or a new `commands/blueprint.rs`).

## Refinement Phase
After initial generation, users can:
1. **Edit manually**: Split view with Mermaid code editor (left) + live preview (right)
2. **Chat refinement**: Ask AI to modify a specific diagram — current source included as context
3. Each edit re-renders the preview in real-time
4. Changes auto-save to `.synk/blueprint.json`

## Deliverables
1. `BlueprintViewer.tsx` — tabbed view of all 5 diagram types, rendered with Mermaid.js
2. `BlueprintEditor.tsx` — split view: Mermaid code editor (left) + live preview (right)
3. `mermaid-utils.ts` — Mermaid initialization, validation, error extraction, rendering helpers
4. AI generates diagrams -> display immediately -> user can edit
5. Save diagrams to `.synk/blueprint.json` via Tauri command
6. Validation: if Mermaid syntax invalid -> show error, don't crash
7. Blueprint persistence Tauri commands (`blueprint_save`, `blueprint_get`)

## Files to Create/Modify
```
src/components/wizard/BlueprintViewer.tsx (populate — currently empty)
src/components/wizard/BlueprintEditor.tsx (populate — currently empty)
src/lib/mermaid-utils.ts                 (populate — currently empty)
src-tauri/src/commands/persistence.rs    (add blueprint_save, blueprint_get commands)
src-tauri/src/lib.rs                     (register blueprint commands)
src/lib/tauri-api.ts                     (add blueprint wrappers)
```

## Acceptance Test
Generate blueprints from brainstorm -> all 5 diagrams render correctly. Switch tabs between diagram types. Edit Mermaid code -> live preview updates instantly. Invalid syntax -> error message shown, app doesn't crash. Save -> `.synk/blueprint.json` written with all diagrams. Reload -> diagrams load from file.
