# Per-Worktree Observability

**Priority:** 7
**Inspired by:** OpenAI Harness Engineering — ephemeral per-worktree browser preview + logs/metrics/traces
**Status:** Spec

---

## Overview

Close the loop between agents and their output by adding per-worktree observability: embedded browser preview (via Chrome DevTools Protocol) and searchable log streaming from dev servers. When agents can see what they built — not just the code — they can validate UI, reproduce bugs, and reason about runtime behavior directly.

This builds on Synk's existing localhost sessions and worktree management.

---

## Decisions

| Question | Answer |
|----------|--------|
| Browser preview method | Embedded webview via Tauri's WebView API, or CDP connection to external browser |
| Where does preview live? | New panel in the drawer, or a floating window per worktree |
| Log storage | In-memory ring buffer (last 10K lines per session), not persisted to disk |
| Log search | Client-side text search with regex support |
| CDP capabilities | Screenshots, DOM snapshots, console logs, network requests |
| Agent access | Agents can request screenshots and DOM state via Synk MCP commands |

---

## Part A: Browser Preview

### User Flow

1. User starts a localhost session for a worktree (e.g., `npm run dev` on port 3001)
2. A "Preview" button appears on the localhost session card in the drawer
3. Clicking opens an embedded browser panel showing the app at `localhost:3001`
4. The preview auto-refreshes on HMR/hot reload
5. Agents can request: "take a screenshot of the current state" or "get the DOM tree"
6. Screenshots/DOM snapshots are saved to a temp directory for agent analysis

### Data Model

```ts
type BrowserPreview = {
  id: string;
  localhostSessionId: string;       // Linked localhost session
  worktreeId: string;               // Linked git worktree
  url: string;                      // e.g., "http://localhost:3001"
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastScreenshotPath: string | null;
  lastDomSnapshotPath: string | null;
  consoleErrors: ConsoleEntry[];    // Captured console.error() calls
};

type ConsoleEntry = {
  level: 'log' | 'warn' | 'error';
  message: string;
  timestamp: string;
  source: string;                   // File + line from stack trace
};
```

### Backend: `src-tauri/src/core/browser_preview.rs`

- `BrowserPreviewManager`:
  - Manages CDP connections to localhost dev servers
  - Can launch headless Chromium or connect to existing browser
- `connect(url) -> BrowserPreview`
  - Establishes CDP connection via WebSocket
- `take_screenshot(preview_id) -> String` (returns file path)
  - Captures screenshot via CDP `Page.captureScreenshot`
  - Saves to `.synk/tmp/screenshots/`
- `get_dom_snapshot(preview_id) -> String` (returns file path)
  - Captures DOM via CDP `DOMSnapshot.captureSnapshot`
  - Saves as structured markdown for agent consumption
- `get_console_errors(preview_id) -> Vec<ConsoleEntry>`
  - Returns captured console errors
- `navigate(preview_id, path)` — navigate to a specific route

### Frontend: Browser Preview Panel

- Embedded `<webview>` component in the drawer or floating panel
- Toolbar: URL bar (read-only), refresh button, screenshot button, DOM snapshot button
- Console error badge — shows count of console errors, click to view
- Resize handle for panel dimensions

---

## Part B: Log Viewer

### User Flow

1. User starts a localhost session — stdout/stderr are already captured
2. A "Logs" tab appears in the drawer (or within the localhost session card)
3. Logs stream in real-time with syntax highlighting for common patterns:
   - Timestamps highlighted
   - ERROR/WARN/INFO level badges
   - HTTP status codes color-coded (200=green, 4xx=yellow, 5xx=red)
   - Stack traces collapsible
4. User can search logs with text or regex
5. User can filter by log level
6. Agents can query logs: "show me the last 50 lines containing 'error'"

### Data Model

```ts
type LogViewer = {
  localhostSessionId: string;
  entries: LogEntry[];               // Ring buffer, max 10K
  filters: LogFilter;
};

type LogEntry = {
  id: number;                        // Sequence number
  timestamp: string;
  source: 'stdout' | 'stderr';
  level: 'debug' | 'info' | 'warn' | 'error' | 'unknown';
  message: string;
  raw: string;                       // Original unprocessed line
};

type LogFilter = {
  search: string;                    // Text or regex search
  levels: Set<string>;              // Which levels to show
  source: 'all' | 'stdout' | 'stderr';
};
```

### Backend: `src-tauri/src/core/log_viewer.rs`

- `LogBuffer` struct:
  - Ring buffer of `LogEntry` with configurable capacity (default 10K)
  - Integrates with existing localhost session PTY output capture
  - Parses log level from common formats (JSON logs, simple prefix patterns)
- `append_log(session_id, raw_line)`
  - Parse level, timestamp, message from raw line
  - Add to ring buffer, emit event to frontend
- `search_logs(session_id, query, limit) -> Vec<LogEntry>`
  - Text or regex search across buffer
  - Used by agents via IPC command
- `filter_logs(session_id, filter) -> Vec<LogEntry>`
  - Level and source filtering
- `clear_logs(session_id)` — flush the buffer

### Frontend: Log Viewer Panel

- In the drawer, as a sub-tab of localhost sessions or standalone tab
- **Log stream:** Virtual-scrolled list of log entries (handles 10K lines smoothly)
- **Search bar:** Text input with regex toggle
- **Level filter:** Toggle buttons for DEBUG/INFO/WARN/ERROR
- **Auto-scroll:** Toggle to auto-scroll to latest entry (default on)
- **Copy:** Select and copy log lines
- **Clear:** Button to flush logs

---

## Agent Integration

### MCP Commands (for agents to use)

When a session is linked to a worktree with a running localhost:

- `synk_screenshot` — takes a screenshot, returns the file path for agent inspection
- `synk_dom_snapshot` — captures DOM, returns structured markdown
- `synk_console_errors` — returns recent console errors
- `synk_search_logs {query} {limit}` — searches log buffer, returns matching lines
- `synk_navigate {path}` — navigates the preview to a specific route

These would be exposed via Synk's MCP server (existing `mcp_server.rs`).

---

## Edge Cases

- Dev server not running — preview shows "No dev server running" placeholder, "Start" button
- Dev server on non-standard port — auto-detected from localhost session config
- CDP connection drops — reconnect automatically with exponential backoff
- Log buffer full — oldest entries evicted (ring buffer behavior)
- Very fast log output (100+ lines/sec) — batch updates to frontend, throttle rendering
- Multiple worktrees with same port — error, prompt user to change port
- Preview for non-web apps (Tauri desktop) — use CDP to connect to the Tauri webview
- HTTPS dev servers — support both HTTP and HTTPS connections

---

## Success Criteria

- [ ] Browser preview loads within 3 seconds of connecting
- [ ] Screenshots are captured in <2 seconds and readable by agents
- [ ] DOM snapshots produce structured output useful for agent reasoning
- [ ] Log viewer handles 10K entries without performance degradation
- [ ] Log search returns results in <500ms
- [ ] Agent MCP commands work reliably from any session type
- [ ] Console errors are captured and surfaced prominently
