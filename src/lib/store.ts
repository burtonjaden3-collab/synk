import { create } from "zustand";

import type { AppSettings, ProjectConfigView, RecentProject, SessionConfigDisk } from "./types";

type AppState = {
  currentProject: RecentProject | null;
  setCurrentProject: (project: RecentProject | null) => void;

  onboardingOpen: boolean;
  setOnboardingOpen: (open: boolean) => void;

  projectConfig: ProjectConfigView | null;
  setProjectConfig: (cfg: ProjectConfigView | null) => void;

  // Per-session overrides loaded from `.synk/config.json`.
  sessionConfigs: Record<number, SessionConfigDisk>;
  setSessionConfig: (sessionId: number, cfg: SessionConfigDisk) => void;
  clearSessionConfigs: () => void;

  // When set (typically by HomeScreen), Workspace should restore this snapshot on entry.
  pendingSessionRestoreId: string | null;
  setPendingSessionRestoreId: (id: string | null) => void;

  settings: AppSettings | null;
  setSettings: (settings: AppSettings | null) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
};

export const useAppStore = create<AppState>((set) => ({
  currentProject: null,
  setCurrentProject: (project) =>
    set({
      currentProject: project,
      // Switching projects invalidates project-level config state.
      projectConfig: null,
      sessionConfigs: {},
      pendingSessionRestoreId: null,
    }),

  onboardingOpen: false,
  setOnboardingOpen: (open) => set({ onboardingOpen: open }),

  projectConfig: null,
  setProjectConfig: (cfg) => {
    const sessionConfigs: Record<number, SessionConfigDisk> = {};
    if (cfg?.sessions) {
      for (const [k, v] of Object.entries(cfg.sessions)) {
        const id = Number(k);
        if (Number.isFinite(id)) sessionConfigs[id] = v;
      }
    }
    set({ projectConfig: cfg, sessionConfigs });
  },

  sessionConfigs: {},
  setSessionConfig: (sessionId, cfg) =>
    set((s) => ({ sessionConfigs: { ...s.sessionConfigs, [sessionId]: cfg } })),
  clearSessionConfigs: () => set({ sessionConfigs: {} }),

  pendingSessionRestoreId: null,
  setPendingSessionRestoreId: (id) => set({ pendingSessionRestoreId: id }),

  settings: null,
  setSettings: (settings) => set({ settings }),
  settingsOpen: false,
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));
