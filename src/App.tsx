import { useEffect, useMemo, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";

import { HomeScreen } from "./components/home/HomeScreen";
import { Workspace } from "./components/workspace/Workspace";
import { Settings } from "./components/shared/Settings";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";
import { useAppStore } from "./lib/store";
import { onboardingIsFirstRun, settingsGet } from "./lib/tauri-api";
import { isSettingsToggle, stopEvent } from "./lib/keybindings";

function App() {
  const currentProject = useAppStore((s) => s.currentProject);
  const settingsOpen = useAppStore((s) => s.settingsOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setSettings = useAppStore((s) => s.setSettings);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const onboardingOpen = useAppStore((s) => s.onboardingOpen);
  const setOnboardingOpen = useAppStore((s) => s.setOnboardingOpen);

  const tauriAvailable = useMemo(() => isTauri(), []);
  const [firstRun, setFirstRun] = useState<boolean | null>(null);

  useEffect(() => {
    if (!tauriAvailable) return;
    settingsGet()
      .then((s) => setSettings(s))
      .catch(() => setSettings(null));
  }, [tauriAvailable, setSettings]);

  useEffect(() => {
    if (!tauriAvailable) {
      setFirstRun(false);
      return;
    }
    onboardingIsFirstRun()
      .then((v) => setFirstRun(v))
      .catch(() => setFirstRun(false));
  }, [tauriAvailable]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Keep onboarding focused; also avoid opening settings while first-run check is pending.
      if (tauriAvailable && firstRun !== false) return;
      if (isSettingsToggle(e)) {
        // Allow opening settings even when focus is inside xterm (it uses a textarea).
        stopEvent(e);
        setSettingsOpen(!settingsOpen);
        return;
      }

      if (settingsOpen && e.key === "Escape") {
        stopEvent(e);
        setSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [settingsOpen, setSettingsOpen, firstRun, tauriAvailable]);

  if (tauriAvailable && firstRun === null) {
    // Avoid mounting HomeScreen/Workspace until we know whether onboarding should take over.
    return (
      <div className="flex h-full items-center justify-center bg-bg-primary text-text-secondary">
        <div className="rounded-2xl border border-border bg-bg-secondary px-4 py-3 font-mono text-xs">
          initializing…
        </div>
      </div>
    );
  }

  if (tauriAvailable && firstRun === true) {
    return (
      <OnboardingWizard
        onFinished={() => {
          // Wizard completion creates the config dir; avoid re-showing without requiring a reload.
          setFirstRun(false);
          // If the wizard didn't open a project (future new-project flow), fall back to home.
          if (!useAppStore.getState().currentProject) setCurrentProject(null);
        }}
      />
    );
  }

  if (tauriAvailable && onboardingOpen) {
    return (
      <OnboardingWizard
        onExit={() => setOnboardingOpen(false)}
        onFinished={() => {
          setOnboardingOpen(false);
          setFirstRun(false);
          if (!useAppStore.getState().currentProject) setCurrentProject(null);
        }}
      />
    );
  }

  return (
    <>
      {currentProject ? <Workspace /> : <HomeScreen />}
      <Settings
        open={firstRun === false && settingsOpen}
        tauriAvailable={tauriAvailable}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}

export default App;
