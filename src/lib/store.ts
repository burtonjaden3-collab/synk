import { create } from "zustand";

import type { RecentProject } from "./types";

type AppState = {
  currentProject: RecentProject | null;
  setCurrentProject: (project: RecentProject | null) => void;
};

export const useAppStore = create<AppState>((set) => ({
  currentProject: null,
  setCurrentProject: (project) => set({ currentProject: project }),
}));

