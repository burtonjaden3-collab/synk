# Synk

Tauri v2 + React + TypeScript scaffold for Synk.

## Dev

```bash
npm ci
npm run tauri dev
```

If you run `npm run dev` directly, you're running in a normal browser context (no Tauri backend),
so session IPC commands (like `session_list`) won't exist.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
