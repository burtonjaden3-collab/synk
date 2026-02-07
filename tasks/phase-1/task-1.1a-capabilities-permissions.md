# TASK 1.1a: Capabilities/Permissions Baseline
> Phase 1 — Foundation | Single Session | Depends on: Task 1.1

## Status
Completed (2026-02-07) in `cdb32ca`.

## What to Build
Decide what functionality runs via Rust backend vs Tauri plugins, then set capabilities/permissions and dependencies accordingly so later phases do not stall on security plumbing.

## What We Enabled (Current Baseline)
- Dialog plugin (for user-selected folders/files via native dialogs)
- Opener plugin

## Files Changed
```
src-tauri/capabilities/default.json
src-tauri/Cargo.toml
src-tauri/src/lib.rs
package.json
package-lock.json
```

## Acceptance Test
`npm run tauri dev` starts without capability permission errors, and dialog/opener plugin APIs are available to the frontend.

