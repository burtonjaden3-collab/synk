import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// Allow running multiple `tauri dev` instances side-by-side (e.g. separate git worktrees).
// Default ports remain compatible with `src-tauri/tauri.conf.json`.
// @ts-expect-error process is a nodejs global
const port = Number(process.env.SYNK_VITE_PORT ?? 1420);
// @ts-expect-error process is a nodejs global
const hmrPortEnv = process.env.SYNK_VITE_HMR_PORT;
const hmrPort = hmrPortEnv ? Number(hmrPortEnv) : port + 1;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: hmrPort,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
      // Some environments (CI, containers, remote dev) have very low inotify watcher limits,
      // which causes ENOSPC crashes if we rely on native file watchers.
      // Polling trades some CPU for reliability.
      usePolling: true,
      interval: 250,
    },
  },
}));
