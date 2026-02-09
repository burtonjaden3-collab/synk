import type { AppSettings } from "./types";

export function defaultAppSettings(): AppSettings {
  return {
    version: 2,
    aiProviders: {
      default: "anthropic",
      anthropic: {
        authMode: "oauth",
        apiKey: null,
        oauthConnected: false,
        oauthEmail: null,
        defaultModel: "claude-sonnet-4-5-20250929",
      },
      google: {
        authMode: "apiKey",
        apiKey: null,
        oauthConnected: false,
        oauthEmail: null,
        defaultModel: "gemini-2.0-flash",
      },
      openai: {
        authMode: null,
        apiKey: null,
        oauthConnected: false,
        oauthEmail: null,
        // Used for Codex panes today (Codex CLI), and as the default OpenAI model in general.
        defaultModel: "gpt-5.3-codex",
      },
      ollama: {
        baseUrl: "http://localhost:11434",
        defaultModel: "llama3.1",
      },
    },
    performance: {
      initialPoolSize: 2,
      maxPoolSize: 4,
      maxActiveSessions: 12,
      recycleEnabled: true,
      maxPtyAgeMinutes: 30,
      warmupDelayMs: 100,
      pollIntervalMs: 5000,
    },
    keyboard: {
      terminalExitMethod: "double_escape",
      doubleEscapeTimeoutMs: 300,
      customBindings: {},
    },
    ui: {
      sidebarWidth: 280,
      drawerHeight: 250,
      drawerPanelOrder: ["cost", "git", "localhost", "tasks", "reviews"],
      showSessionCostInHeader: true,
      dimUnfocusedPanes: true,
      unfocusedOpacity: 0.7,
    },
    notifications: {
      taskCompleted: true,
      agentError: true,
      mergeConflict: true,
      reviewReady: true,
      costThreshold: null,
      position: "top-right",
      durationMs: 5000,
    },
    git: {
      defaultMergeStrategy: "squash",
      autoDelegateConflicts: true,
      worktreeBasePath: "~/.synk/worktrees",
      branchPrefix: "feat/",
    },
    session: {
      autoSave: true,
      autoSaveIntervalSeconds: 60,
    },
    gastown: {
      cliPath: null,
      workspacePath: "~/gt/",
      pinnedVersion: "0.3.x",
    },
  };
}
