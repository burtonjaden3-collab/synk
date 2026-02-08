import { create } from "zustand";

import type { AppSettings, GitEvent, ProjectConfigView, RecentProject, SessionConfigDisk } from "./types";

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

  // Git activity feed events, keyed by project path.
  // Kept in-memory (not persisted) so the feed doesn't reset when the panel unmounts.
  gitEventsByProject: Record<string, GitEvent[]>;
  appendGitEvent: (projectPath: string, ev: GitEvent) => void;
  clearGitEvents: (projectPath?: string | null) => void;
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

  gitEventsByProject: {},
  appendGitEvent: (projectPath, ev) =>
    set((s) => {
      const prev = s.gitEventsByProject[projectPath] ?? [];
      if (prev.some((p) => p.id === ev.id)) return s;
      const next = [...prev, ev];
      const bounded = next.length > 400 ? next.slice(next.length - 400) : next;
      return { gitEventsByProject: { ...s.gitEventsByProject, [projectPath]: bounded } };
    }),
  clearGitEvents: (projectPath) =>
    set((s) => {
      if (!projectPath) return { gitEventsByProject: {} };
      const { [projectPath]: _ignored, ...rest } = s.gitEventsByProject;
      return { gitEventsByProject: rest };
    }),
}));
