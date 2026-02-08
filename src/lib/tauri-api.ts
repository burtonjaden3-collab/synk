import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  DetectedAgent,
  McpDiscoveryResult,
  ProjectConfigView,
  RecentProject,
  SessionConfigDisk,
  SessionCreateArgs,
  SessionCreateResponse,
  SessionExitEvent,
  SessionId,
  SessionInfo,
  SessionOutputEvent,
  SessionScrollbackResponse,
  SessionSnapshot,
  SessionSnapshotMeta,
  AppSettings,
  ProviderKeyValidationResult,
  ProviderModelsResult,
  SkillsDiscoveryResult,
  OnboardingScanResult,
} from "./types";

export function agentsList() {
  return invoke<DetectedAgent[]>("agents_list");
}

export function persistenceListRecentProjects() {
  return invoke<RecentProject[]>("list_recent_projects");
}

export function persistenceOpenProject(path: string) {
  return invoke<RecentProject>("open_project", { args: { path } });
}

export function projectConfigGet(projectPath: string) {
  return invoke<ProjectConfigView>("project_config_get", { args: { projectPath } });
}

export function projectSessionConfigGet(projectPath: string, sessionId: number) {
  return invoke<SessionConfigDisk | null>("project_session_config_get", {
    args: { projectPath, sessionId },
  });
}

export function projectSessionConfigSet(projectPath: string, sessionId: number, cfg: SessionConfigDisk) {
  return invoke<void>("project_session_config_set", {
    args: {
      projectPath,
      sessionId,
      agentType: cfg.agentType ?? null,
      branch: cfg.branch ?? null,
      worktreeIsolation: cfg.worktreeIsolation ?? null,
      skills: cfg.skills ?? [],
      mcpServers: cfg.mcpServers ?? [],
    },
  });
}

export function sessionSnapshotSaveNamed(projectPath: string, name: string, orchestrationMode: string) {
  return invoke<SessionSnapshotMeta>("session_snapshot_save_named", {
    args: { projectPath, name, orchestrationMode },
  });
}

export function sessionSnapshotSaveAutosave(projectPath: string, orchestrationMode: string) {
  return invoke<SessionSnapshotMeta>("session_snapshot_save_autosave", {
    args: { projectPath, orchestrationMode },
  });
}

export function sessionSnapshotList(projectPath?: string | null) {
  return invoke<SessionSnapshotMeta[]>("session_snapshot_list", {
    args: { projectPath: projectPath ?? null },
  });
}

export function sessionSnapshotLoad(id: string) {
  return invoke<SessionSnapshot>("session_snapshot_load", { args: { id } });
}

export function sessionSnapshotAutosaveMeta(projectPath: string) {
  return invoke<SessionSnapshotMeta | null>("session_snapshot_autosave_meta", {
    args: { projectPath },
  });
}

export function sessionCreate(args: SessionCreateArgs) {
  return invoke<SessionCreateResponse>("session_create", { args });
}

export function sessionDestroy(sessionId: SessionId) {
  return invoke<{ success: boolean }>("session_destroy", { args: { sessionId } });
}

export function sessionWrite(sessionId: SessionId, data: string) {
  return invoke<void>("session_write", { args: { sessionId, data } });
}

export function sessionResize(sessionId: SessionId, cols: number, rows: number) {
  return invoke<void>("session_resize", { args: { sessionId, cols, rows } });
}

export function sessionScrollback(sessionId: SessionId) {
  return invoke<SessionScrollbackResponse>("session_scrollback", { args: { sessionId } });
}

export function sessionList() {
  return invoke<SessionInfo[]>("session_list");
}

export async function onSessionOutput(
  handler: (payload: SessionOutputEvent) => void,
) {
  return listen<SessionOutputEvent>("session:output", (event) => handler(event.payload));
}

export async function onSessionExit(handler: (payload: SessionExitEvent) => void) {
  return listen<SessionExitEvent>("session:exit", (event) => handler(event.payload));
}

export function skillsDiscover(projectPath?: string | null) {
  return invoke<SkillsDiscoveryResult>("skills_discover", {
    args: { projectPath: projectPath ?? null },
  });
}

export function skillsSetEnabled(name: string, enabled: boolean, path?: string | null, description?: string | null) {
  return invoke<void>("skills_set_enabled", {
    args: { name, enabled, path: path ?? null, description: description ?? null },
  });
}

export function mcpDiscover(projectPath?: string | null) {
  return invoke<McpDiscoveryResult>("mcp_discover", {
    args: { projectPath: projectPath ?? null },
  });
}

export function mcpSetEnabled(
  name: string,
  enabled: boolean,
  projectPath?: string | null,
  scope?: "global" | "project" | null,
) {
  return invoke<void>("mcp_set_enabled", {
    args: { name, enabled, projectPath: projectPath ?? null, scope: scope ?? null },
  });
}

export function settingsGet() {
  return invoke<AppSettings>("settings_get");
}

export function settingsSet(settings: AppSettings) {
  return invoke<AppSettings>("settings_set", { args: { settings } });
}

export function settingsValidateProviderKey(provider: string, apiKey: string) {
  return invoke<ProviderKeyValidationResult>("settings_validate_provider_key", {
    args: { provider, apiKey },
  });
}

export function settingsListProviderModels(provider: string, apiKey: string) {
  return invoke<ProviderModelsResult>("settings_list_provider_models", {
    args: { provider, apiKey },
  });
}

// -----------------------------------------------------------------------------
// Onboarding (Task 2.6)
// -----------------------------------------------------------------------------

export function onboardingIsFirstRun() {
  return invoke<boolean>("onboarding_is_first_run");
}

export function onboardingInitialize() {
  return invoke<void>("onboarding_initialize");
}

export function onboardingScan() {
  return invoke<OnboardingScanResult>("onboarding_scan");
}
