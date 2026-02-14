# Project Tabs — Multi-Project Workspace

## Overview

Add browser-style tabs so multiple projects can be open simultaneously. Each tab is a fully independent workspace with its own sessions, sidebar state, and drawer contents. Switching tabs leaves background sessions running. Closing a tab warns if sessions are active, then tears everything down.

---

## Decisions

| Question | Answer |
|----------|--------|
| Tab location | Top of window, horizontal bar (browser-style) |
| Closing behavior | Warn if sessions running, then kill |
| Opening a new tab | "+" button on tab bar opens native folder picker directly |
| Tab limit | None — user manages their own resources |
| Sidebar behavior | Follows active tab, remembers scroll/collapse state per tab |
| Drawer behavior | Per-project contents, shared open/closed + height state |
| Keyboard shortcuts | All existing shortcuts scoped to active tab; add tab-switching shortcuts |
| PTY pool | One shared global pool, all tabs draw from it |

---

## Data Model

### New type: `ProjectTab`

```ts
type ProjectTab = {
  id: string;                  // UUID, stable across restarts
  project: RecentProject;      // path, name, last opened, etc.
  sessionIds: number[];        // active session IDs belonging to this tab
  gridLayout: GridLayout;      // session grid arrangement

  // Per-tab sidebar state
  sidebar: {
    scrollTop: number;
    collapsedSections: string[];
  };

  // Per-tab project config (loaded from .synk/config.json)
  projectConfig: ProjectConfigView | null;
  sessionConfigs: Record<number, SessionConfigDisk>;
};
```

### Store changes

Replace the single-project model with a tab list:

```
Remove:
  currentProject: RecentProject | null
  projectConfig: ProjectConfigView | null
  sessionConfigs: Record<number, SessionConfigDisk>
  pendingSessionRestoreId: string | null

Add:
  openTabs: ProjectTab[]           // ordered list, position = tab order
  activeTabId: string | null       // which tab is focused

  openTab(project: RecentProject): void
  closeTab(tabId: string): void
  switchTab(tabId: string): void
  reorderTabs(fromIndex: number, toIndex: number): void

Derived (compatibility getters):
  currentProject  →  computed from activeTabId + openTabs
  projectConfig   →  computed from active tab
  sessionConfigs  →  computed from active tab
```

The derived getters let existing components that read `currentProject` keep working without immediate rewrites. Migrate components off the getters over time.

### What stays global (not per-tab)

- PTY pool (shared across all tabs)
- App settings
- Drawer open/closed state + height
- Onboarding state
- Settings panel state

### What becomes per-tab

- Session list and grid layout
- Sidebar state (scroll position, collapsed sections)
- Drawer contents (git feed, cost tracker, review queue)
- Project config (`.synk/config.json`)
- Git event history (already keyed by project path in `gitEventsByProject`)

---

## Component Architecture

### New components

#### `src/components/tabs/TabBar.tsx`

Horizontal tab strip at the top of the window.

- Renders one tab per entry in `openTabs`
- Active tab has a highlighted style
- Each tab shows: project name, close button (X)
- "+" button at the end opens native folder picker via Tauri dialog
- Tabs are draggable to reorder (updates `openTabs` order)
- Close button triggers the warning dialog if sessions are running
- Middle-click to close (browser convention)
- Right-click context menu: "Close", "Close Others", "Close All"

#### `src/components/tabs/ProjectTabContainer.tsx`

Wrapper that renders all open workspaces and shows/hides them.

```tsx
// Pseudostructure
{openTabs.map(tab => (
  <div key={tab.id} style={{ display: tab.id === activeTabId ? 'contents' : 'none' }}>
    <Workspace projectTab={tab} />
  </div>
))}
```

Uses CSS `display: none` on inactive tabs rather than unmounting. This keeps xterm.js terminal instances alive in the DOM — no reattach cost, no lost scroll position, no visual glitches. When a tab becomes active, call `terminal.fit()` to handle any resize that happened while hidden.

### Modified components

#### `App.tsx`

Current flow:
```
currentProject ? <Workspace /> : <HomeScreen />
```

New flow:
```
openTabs.length > 0
  ? <>
      <TabBar />
      <ProjectTabContainer />
    </>
  : <HomeScreen />
```

The home screen shows when zero tabs are open. Opening a project from the home screen's recent list or folder picker creates a tab and switches to it.

#### `Workspace.tsx`

Currently assumes it's the only workspace. Changes:
- Accept a `projectTab` prop instead of reading `currentProject` from global store
- Scope all session operations to the tab's session list
- Scope IPC event subscriptions to the tab's session IDs

#### `Sidebar.tsx`

- Reads sidebar state (scroll, collapsed sections) from the active tab
- Writes state changes back to the active tab's entry in `openTabs`
- Content (session list, skills, MCP, git) comes from the active tab's project

#### `BottomDrawer.tsx`

- Open/closed state + height: stays in global store (shared)
- Contents (git feed, cost data, review queue): reads from active tab's project path
- Git events already use `gitEventsByProject[path]` — no change needed there

---

## Tab Lifecycle

### Opening a tab

1. User clicks "+" on the tab bar
2. Native folder picker opens (Tauri dialog)
3. On folder selection:
   - Check if this project is already open in another tab → if so, switch to it
   - Otherwise: create a new `ProjectTab` with a fresh UUID
   - Append to `openTabs`, set as `activeTabId`
   - Load `.synk/config.json` for the project
   - Mount a new `<Workspace>` (via `ProjectTabContainer`)
4. Update recent projects list

### Switching tabs

1. User clicks a tab, presses Ctrl+Tab, or presses Ctrl+1-9
2. Set `activeTabId` to the target tab
3. Save current sidebar scroll/collapse state to the outgoing tab
4. The outgoing workspace gets `display: none` (stays mounted, PTYs keep running)
5. The incoming workspace gets `display: contents`
6. Call `terminal.fit()` on all visible xterm instances (handles resize)
7. Sidebar and drawer contents swap to the incoming tab's data

### Closing a tab

1. User clicks X on a tab (or middle-clicks, or uses context menu)
2. Check if the tab has active sessions:
   - If yes: show confirmation dialog — "Project X has N running sessions. Close anyway?"
   - If no: proceed immediately
3. On confirm:
   - Destroy all sessions belonging to this tab (release PTYs back to pool)
   - Remove the tab from `openTabs`
   - If the closed tab was active: switch to the nearest tab (prefer right, then left)
   - If no tabs remain: show the home screen
4. Clean up per-tab state (git events, project config)

---

## Keyboard Shortcuts

All existing shortcuts (vim nav, broadcast, command bar) remain scoped to the active tab. No changes needed — they already operate on the focused workspace.

New shortcuts:

| Shortcut | Action |
|----------|--------|
| `Ctrl+Tab` | Switch to next tab (wraps around) |
| `Ctrl+Shift+Tab` | Switch to previous tab (wraps around) |
| `Ctrl+1` through `Ctrl+9` | Switch to tab by position (Ctrl+9 = last tab) |
| `Ctrl+W` | Close active tab (triggers warning if sessions active) |
| `Ctrl+T` | Open new tab (folder picker) |

---

## xterm.js Background Strategy

When a tab is inactive, its workspace is hidden via `display: none`. The xterm.js `Terminal` objects remain attached to their (hidden) DOM containers. PTY output continues flowing via IPC events and gets written to the terminal buffer — it's just not painted.

When the tab becomes active again:
1. The container becomes visible
2. Call `fit()` on each terminal to recalculate dimensions
3. If the terminal's container size changed while hidden, `fit()` sends a resize to the PTY

This is the same strategy VS Code uses for background editor tabs. No special buffering or replay logic needed.

---

## IPC Event Routing

No backend changes required. The current architecture already supports this:

- `session:output` events include a `session_id` — each Workspace already filters to its own sessions
- Git events are keyed by project path in the store
- Cost tracking is per-session, which maps to per-tab

The only consideration: when subscribing to Tauri events, each Workspace instance registers its own listener. With multiple workspaces mounted, multiple listeners fire for each event. Each listener filters by its own session IDs and discards irrelevant events. This is fine at small scale (tens of sessions). If it becomes a bottleneck, route events through a single global listener that dispatches to the correct tab.

---

## Persistence

### Save (on app close or auto-save)

Save the tab list to the global app state (alongside `projects.json`):

```json
// tabs.json (in Tauri app data dir)
{
  "tabs": [
    {
      "id": "uuid-1",
      "projectPath": "/home/user/project-a",
      "activeSessionRestore": "snapshot-id-1"
    },
    {
      "id": "uuid-2",
      "projectPath": "/home/user/project-b",
      "activeSessionRestore": "snapshot-id-2"
    }
  ],
  "activeTabId": "uuid-1"
}
```

Each tab's session layout is saved via the existing session persistence system (`.synk/sessions/`).

### Restore (on app launch)

1. Read `tabs.json`
2. For each tab entry: create a `ProjectTab`, load project config, restore session layout
3. Set the previously active tab as active
4. If any project paths no longer exist: skip that tab, show a notification

---

## Files Changed

### New files

| File | Purpose |
|------|---------|
| `src/components/tabs/TabBar.tsx` | Tab strip component |
| `src/components/tabs/ProjectTabContainer.tsx` | Mounts all workspaces, shows/hides by active tab |

### Modified files

| File | Change |
|------|--------|
| `src/lib/types.ts` | Add `ProjectTab` type |
| `src/lib/store.ts` | Replace single-project state with `openTabs` / `activeTabId`, add tab actions, add compatibility getters |
| `src/App.tsx` | Render `TabBar` + `ProjectTabContainer` when tabs are open, `HomeScreen` when empty |
| `src/components/workspace/Workspace.tsx` | Accept `projectTab` prop, scope sessions and events to that tab |
| `src/components/sidebar/Sidebar.tsx` | Read/write sidebar state from active tab |
| `src/components/drawer/BottomDrawer.tsx` | Contents from active tab, chrome stays global |
| `src/components/home/HomeScreen.tsx` | "Open project" now creates a tab instead of setting `currentProject` |
| `src/lib/keybindings.ts` | Add tab switching shortcuts (Ctrl+Tab, Ctrl+1-9, Ctrl+W, Ctrl+T) |
| `src-tauri/src/commands/persistence.rs` | Save/restore `tabs.json` |

### No backend changes needed

The PTY pool, session manager, and IPC event system are already ID-based and project-agnostic. Multiple workspaces consuming sessions from the same pool works without Rust-side modifications.

---

## Implementation Order

1. **Types + store refactor** — `ProjectTab` type, new store shape with compatibility getters. Nothing visual changes yet; existing components work via the getters.
2. **TabBar + ProjectTabContainer** — new components, wire into `App.tsx`. Single-tab usage works identically to current behavior.
3. **Multi-tab support** — "+" button, folder picker integration, tab switching, close with warning.
4. **Keyboard shortcuts** — Ctrl+Tab, Ctrl+1-9, Ctrl+W, Ctrl+T.
5. **Per-tab sidebar/drawer state** — save and restore scroll position, collapsed sections per tab.
6. **Persistence** — `tabs.json` save/restore across app restarts.
7. **Polish** — drag to reorder tabs, context menu, duplicate project detection.
