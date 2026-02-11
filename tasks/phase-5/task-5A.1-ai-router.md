# TASK 5A.1: AI Provider Router (Backend)
> Phase 5 — Brainstorm Wizard | Session A (Backend) | Depends on: Phases 1-3 (no blocking dependency on Phase 4)

## What to Build
AI provider abstraction layer: provider trait with streaming support, implementations for all 4 providers (Anthropic, Google, OpenAI, Ollama), API key auth, SSE streaming via spawned blocking threads.

## Changed from Original Spec
- **OAuth deferred**: OAuth flow (keyring, token refresh, callbacks) deferred to a future phase. Phase 5 implements API key auth only. The `oauthConnected`/`oauthEmail` fields remain as placeholders in the settings types.
- **Blocking thread streaming**: Uses `std::thread::spawn` + blocking `reqwest` to read SSE line-by-line, emitting Tauri events. No tokio/async runtime needed — consistent with existing codebase.
- **Model defaults updated**: Anthropic default is `claude-opus-4-6` (was `claude-sonnet-4-5-20250929`). OpenAI default is `gpt-5.3-codex` (was `gpt-4o`). These match the current settings v3 migration in `core/settings.rs`.
- **Event names standardized**: All use hyphens to match existing patterns: `ai:stream-chunk`, `ai:stream-done`, `ai:stream-error`.

## Provider Trait
```rust
use std::sync::mpsc;

pub trait AiProvider: Send + Sync {
    fn name(&self) -> &str;

    /// Non-streaming completion. Blocks the calling thread.
    fn complete(
        &self,
        messages: &[ChatMessage],
        system_prompt: &str,
        options: &ChatOptions,
    ) -> Result<CompletionResult, ProviderError>;

    /// Streaming completion. Spawns a background thread that reads SSE
    /// and sends chunks through the returned receiver.
    fn stream(
        &self,
        messages: &[ChatMessage],
        system_prompt: &str,
        options: &ChatOptions,
    ) -> Result<mpsc::Receiver<StreamChunk>, ProviderError>;

    /// Validate that the API key works (lightweight models endpoint hit).
    fn validate_key(&self, key: &str) -> Result<bool, ProviderError>;
}

pub struct ChatMessage {
    pub role: Role,          // User, Assistant
    pub content: String,
}

pub enum Role { User, Assistant }

pub struct ChatOptions {
    pub model: Option<String>,       // override default model
    pub temperature: Option<f32>,    // 0.0-2.0
    pub max_tokens: Option<usize>,
    pub json_mode: bool,             // request JSON output (for structured extraction)
}

pub enum StreamChunk {
    Text(String),                    // content token
    Done { usage: TokenUsage },      // stream complete
    Error(String),                   // stream error
}

pub struct CompletionResult {
    pub content: String,
    pub usage: TokenUsage,
}

pub struct TokenUsage {
    pub input_tokens: usize,
    pub output_tokens: usize,
}
```

## All 4 Providers Use Raw reqwest (blocking)
No SDKs. Direct HTTP. SSE parsing done manually by reading the response body line-by-line in a spawned `std::thread`.

## Streaming Pipeline
```
Frontend calls: invoke('ai_chat_stream', { provider, messages, systemPrompt, options })
    |
    v
Rust backend (Tauri command):
    1. Generates a unique streamId (uuid)
    2. Returns { streamId } immediately to frontend
    3. Spawns std::thread that:
       a. Opens blocking HTTP connection with streaming headers
       b. Reads response body line-by-line
       c. Parses SSE events (data: lines)
       d. For each text delta: emits Tauri event 'ai:stream-chunk' { streamId, text }
       e. On completion: emits 'ai:stream-done' { streamId, usage }
       f. On error: emits 'ai:stream-error' { streamId, error }
    |
    v
Frontend:
    1. Receives { streamId } from invoke
    2. Listens for 'ai:stream-chunk' events filtered by streamId
    3. Appends to streamBuffer, renders partial markdown
    4. On 'ai:stream-done': finalize message, parse <structured> block
```

## Provider Implementations

| Provider | Endpoint | Default Model | Auth |
|----------|----------|---------------|------|
| Anthropic | `https://api.anthropic.com/v1/messages` | `claude-opus-4-6` | `x-api-key` header |
| Google | `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent` | `gemini-2.0-flash` | `?key=` param |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-5.3-codex` | `Authorization: Bearer` |
| Ollama | `http://localhost:11434/api/chat` | User-selected (from settings) | None (local) |

## Auth: API Key Only (Phase 5)
- User configures API key in Settings (already built in Phase 2)
- Keys read from `~/.config/synk/settings.json` via existing `settings_get()`
- Existing `validate_provider_key()` in `core/settings.rs` already validates keys for Anthropic/Google/OpenAI — reuse this
- OAuth deferred to a future phase. The `oauthConnected`/`oauthEmail` fields in `ProviderAuthSettings` remain as inert placeholders.

## Wiring Requirements
The `ai/` directory already exists with empty placeholder files. To compile them:
1. Add `mod ai;` to `src-tauri/src/lib.rs`
2. Populate `ai/mod.rs` with the trait + types + provider registry
3. Wire new Tauri commands in `commands/ai_provider.rs`
4. Register commands in `lib.rs` `invoke_handler![]` macro

## Deliverables
1. `ai/mod.rs` — AiProvider trait, ChatMessage/ChatOptions/StreamChunk types, ProviderRegistry
2. `ai/anthropic.rs` — Messages API v1, SSE parsing for `content_block_delta` events
3. `ai/google.rs` — Gemini `streamGenerateContent`, SSE parsing
4. `ai/openai.rs` — Chat Completions with `stream: true`, SSE parsing
5. `ai/ollama.rs` — Local REST at `/api/chat` with `stream: true`, NDJSON line parsing
6. `commands/ai_provider.rs` — Tauri commands: `ai_chat_stream`, `ai_chat_complete`, `ai_validate_key`
7. `lib.rs` — add `mod ai;`, register new commands in `invoke_handler`

## Files to Create/Modify
```
src-tauri/src/ai/mod.rs            (populate — currently empty)
src-tauri/src/ai/anthropic.rs      (populate — currently empty)
src-tauri/src/ai/google.rs         (populate — currently empty)
src-tauri/src/ai/openai.rs         (populate — currently empty)
src-tauri/src/ai/ollama.rs         (populate — currently empty)
src-tauri/src/commands/ai_provider.rs (populate — currently empty)
src-tauri/src/lib.rs               (add mod ai; + register commands)
src/lib/tauri-api.ts               (add aiChatStream, aiChatComplete, aiValidateKey wrappers)
src/lib/types.ts                   (add AI streaming types)
```

## Tauri Commands

```typescript
// Start a streaming chat — returns immediately with a streamId.
// Tokens arrive via 'ai:stream-chunk' events.
invoke('ai_chat_stream', {
  args: {
    provider: 'anthropic' | 'google' | 'openai' | 'ollama',
    messages: ChatMessage[],
    systemPrompt: string,
    options?: ChatOptions,
  }
}) -> { streamId: string }

// Non-streaming chat — blocks until complete response.
invoke('ai_chat_complete', {
  args: {
    provider: 'anthropic' | 'google' | 'openai' | 'ollama',
    messages: ChatMessage[],
    systemPrompt: string,
    options?: ChatOptions,
  }
}) -> { response: string, usage: TokenUsage }

// Validate an API key (reuses existing settings validation logic).
invoke('ai_validate_key', {
  args: { provider: string, key: string }
}) -> { valid: boolean, error?: string }
```

## Tauri Events (Backend -> Frontend)

```typescript
listen('ai:stream-chunk', {
  streamId: string,
  text: string,
})

listen('ai:stream-done', {
  streamId: string,
  usage: TokenUsage,
})

listen('ai:stream-error', {
  streamId: string,
  error: string,
})
```

## SSE Parsing Notes
Each provider has a different SSE format:
- **Anthropic**: `data: {"type":"content_block_delta","delta":{"text":"..."}}`
- **OpenAI**: `data: {"choices":[{"delta":{"content":"..."}}]}` — terminates with `data: [DONE]`
- **Google**: Response is NDJSON array chunks with `candidates[0].content.parts[0].text`
- **Ollama**: NDJSON lines with `{"message":{"content":"..."},"done":false}` — final line has `"done":true`

The SSE parser in each provider reads the response body line-by-line using `reqwest::blocking::Response::text()` split on newlines, or `BufReader::lines()` on the response bytes.

## Acceptance Test
Call `ai_chat_stream` with Anthropic provider + valid API key -> tokens stream via `ai:stream-chunk` events -> `ai:stream-done` fires with usage. Switch to Ollama (if running locally) -> local model responds. Call `ai_validate_key` with invalid key -> returns `{ valid: false, error: "..." }`.
