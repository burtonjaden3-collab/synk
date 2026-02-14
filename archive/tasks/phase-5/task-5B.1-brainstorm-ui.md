# TASK 5B.1: Brainstorm Chat UI (Frontend)
> Phase 5 — Brainstorm Wizard | Session B (Frontend) | Depends on: Task 5A.1

## What to Build
Full-screen conversational chat interface for brainstorming project ideas with AI. Provider selector. Streaming response rendering. Structured data extraction panel.

## Changed from Original Spec
- **Dependency fixed**: Depends on Task 5A.1 (AI provider router), not Phase 4. No orchestrator dependency.
- **OAuth references removed**: Provider selector only shows providers with valid API keys configured in Settings. No OAuth sign-in flow.
- **Event names standardized**: Uses `ai:stream-chunk`, `ai:stream-done`, `ai:stream-error` (hyphens, matching codebase convention).
- **`<structured>` parsing clarified**: Only parse the `<structured>` XML block from the **complete** response (on `ai:stream-done`), not during streaming. During streaming, just render the raw text including the XML tag as-is.
- **Wizard entry point defined**: "New Project" button on HomeScreen routes to the wizard. Add wizard route to App.tsx.

## The Brainstorm Flow
1. User clicks "New Project" on HomeScreen -> enters full-screen wizard
2. User selects AI provider (dropdown: shows providers with API keys configured)
3. Chat interface: conversational back-and-forth about the project idea
4. AI extracts structured data as conversation progresses (project name, tech stack, features)
5. Extracted data displayed in side panel
6. When ready: "Generate Blueprint" button -> triggers diagram generation (Task 5B.2)

## Brainstorm State (React local state, not Zustand)
```typescript
interface BrainstormState {
  provider: 'anthropic' | 'google' | 'openai' | 'ollama';
  messages: ChatMessage[];           // full conversation history
  extractedData: ProjectBlueprint;   // structured data extracted so far
  currentPhase: 'brainstorm' | 'blueprint' | 'refine' | 'export';
  isStreaming: boolean;
  streamBuffer: string;              // current response being streamed
  currentStreamId: string | null;    // streamId from ai_chat_stream
}

interface ProjectBlueprint {
  name: string | null;
  description: string | null;
  techStack: string[];
  features: Feature[];
  entities: Entity[];
  diagrams: {
    architecture: string | null;     // mermaid source
    fileStructure: string | null;
    database: string | null;
    apiRoutes: string | null;
    deployment: string | null;
  };
}

interface Feature {
  name: string;
  description: string;
}

interface Entity {
  name: string;
  fields: string[];
}
```

## Conversation Flow

### Phase 1: Brainstorm Chat
Every message to the AI includes a system prompt that instructs it to:
1. Ask clarifying questions about the project
2. Extract structured data and embed it in a `<structured>` XML tag at the end of each response
3. Signal when it has enough information to generate blueprints

```
SYSTEM PROMPT (brainstorm phase):
You are a senior software architect helping plan a new project.
Your job is to understand what the user wants to build through conversation.

Ask focused questions about: tech stack preferences, target users,
core features, data models, scale expectations, deployment target.

After each response, include a <structured> block with any new
information you've extracted. Use this exact JSON schema:
<structured>
{
  "name": "project-name-or-null",
  "description": "one-line-description-or-null",
  "tech_stack": ["react", "node"],
  "features": [{"name": "Auth", "description": "User login/signup"}],
  "entities": [{"name": "User", "fields": ["id", "email", "name"]}],
  "ready_for_blueprint": false
}
</structured>

Set ready_for_blueprint to true ONLY when you have enough information
to generate all 5 diagram types.
```

### Structured Data Parsing
On `ai:stream-done`:
1. Take the complete response text
2. Find `<structured>` and `</structured>` tags
3. Parse the JSON between them
4. Merge with existing `extractedData` (new fields overwrite, arrays append/deduplicate)
5. Strip the `<structured>...</structured>` block from the displayed message
6. If `ready_for_blueprint` is true, show the "Generate Blueprint" button

The side panel (StructuredExtract.tsx) shows extraction progress:
- Project name: filled or empty
- Tech stack: count of items
- Features: count of items
- Entities: count of items
- Ready indicator: green when `ready_for_blueprint` is true

### Phase 2: Blueprint Generation
User clicks "Generate Blueprint." Transitions to the BlueprintViewer (Task 5B.2) which sends 5 sequential AI requests for diagrams.

## Streaming Implementation
```
1. User types message, clicks send
2. Frontend calls: invoke('ai_chat_stream', { args: { provider, messages, systemPrompt } })
3. Backend returns: { streamId: "uuid" }
4. Frontend sets: currentStreamId = streamId, isStreaming = true
5. Frontend listens for 'ai:stream-chunk' where event.payload.streamId matches
6. Each chunk: append event.payload.text to streamBuffer, re-render chat
7. On 'ai:stream-done':
   a. Set isStreaming = false
   b. Move streamBuffer to messages array as assistant message
   c. Parse <structured> block, update extractedData
   d. Clear streamBuffer and currentStreamId
8. On 'ai:stream-error':
   a. Show error toast
   b. Set isStreaming = false
```

## Deliverables
1. `BrainstormWizard.tsx` — full-screen wizard layout (replaces workspace when active)
2. `ChatBrainstorm.tsx` — chat message list + input, streaming token rendering
3. `StructuredExtract.tsx` — side panel showing extracted data (name, stack, features, description)
4. Provider selector dropdown (only shows providers with API keys configured)
5. Streaming: tokens appear as they arrive via `ai:stream-chunk` events
6. Conversation state: messages array in React state (not Zustand — ephemeral)
7. `App.tsx` — add wizard route (HomeScreen -> BrainstormWizard -> Workspace)

## Files to Create/Modify
```
src/components/wizard/BrainstormWizard.tsx  (populate — currently empty)
src/components/wizard/ChatBrainstorm.tsx    (populate — currently empty)
src/components/wizard/StructuredExtract.tsx (populate — currently empty)
src/App.tsx                                 (add wizard route)
src/lib/tauri-api.ts                        (add AI stream event listeners)
```

## Acceptance Test
Open brainstorm wizard via "New Project". Select Anthropic (must have API key configured). Type project idea -> AI responds with streaming tokens appearing in real-time. Side panel shows extracted project name + tech stack. When ready_for_blueprint is true, "Generate Blueprint" button appears. Conversation continues naturally with multiple exchanges.
