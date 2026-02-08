import ReactDOM from "react-dom/client";
import App from "./App";

import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "xterm/css/xterm.css";
import "./styles/globals.css";

// Register global hotkeys as early as possible. Some components (xterm) attach
// capture handlers that may stop propagation, so doing this pre-React makes
// Ctrl+, / Cmd+, more reliable.
import { useAppStore } from "./lib/store";
import { isSettingsToggle } from "./lib/keybindings";

function installGlobalHotkeys() {
  const g = globalThis as unknown as { __synkHotkeysInstalled?: boolean };
  if (g.__synkHotkeysInstalled) return;
  g.__synkHotkeysInstalled = true;

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.defaultPrevented) return;
      if (!isSettingsToggle(e)) return;

      e.preventDefault();
      e.stopPropagation();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (e as any).stopImmediatePropagation?.();

      const st = useAppStore.getState();
      st.setSettingsOpen(!st.settingsOpen);
    },
    true,
  );
}

installGlobalHotkeys();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
