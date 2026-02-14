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
  SessionCostUpdatedEvent,
  SessionScrollbackResponse,
  SessionSnapshot,
  SessionSnapshotMeta,
  AppSettings,
  ProviderKeyValidationResult,
  ProviderModelsResult,
  SkillsDiscoveryResult,
  OnboardingScanResult,
  GitCreateWorktreeResponse,
  WorktreeInfo,
  OrphanWorktree,
  GitCleanupOrphansResponse,
  FileDiff,
  GitMergeResult,
  MergeStrategy,
  GitEvent,
  ReviewItem,
  ReviewStatus,
  ReviewDecision,
  LocalhostSessionLogEvent,
  LocalhostSessionSpec,
  LocalhostSessionStatusEvent,
  LocalhostSessionView,
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

export function sessionCd(sessionId: SessionId, dir: string, branch?: string | null) {
  return invoke<void>("session_cd", { args: { sessionId, dir, branch: branch ?? null } });
}

export function sessionRestart(sessionId: SessionId, dir: string, branch?: string | null, model?: string | null) {
  return invoke<SessionInfo>("session_restart", {
    args: { sessionId, dir, branch: branch ?? null, model: model ?? null },
  });
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

// -----------------------------------------------------------------------------
// Git (Phase 3A)
// -----------------------------------------------------------------------------

export function gitCreateWorktree(sessionId: SessionId, branch: string, baseBranch?: string | null) {
  return invoke<GitCreateWorktreeResponse>("git_create_worktree", {
    args: { sessionId, branch, baseBranch: baseBranch ?? null },
  });
}

export function gitEnsureWorktree(projectPath: string, branch: string, baseBranch?: string | null) {
  return invoke<GitCreateWorktreeResponse>("git_ensure_worktree", {
    args: { projectPath, branch, baseBranch: baseBranch ?? null },
  });
}

export function gitRemoveWorktree(sessionId: SessionId, branch?: string | null) {
  return invoke<{ success: boolean }>("git_remove_worktree", {
    args: { sessionId, branch: branch ?? null },
  });
}

// Alias to match the spec reference.
export function gitDeleteWorktree(sessionId: SessionId, branch?: string | null) {
  return invoke<{ success: boolean }>("git_delete_worktree", {
    args: { sessionId, branch: branch ?? null },
  });
}

export function gitListWorktrees(projectPath: string) {
  return invoke<WorktreeInfo[]>("git_list_worktrees", { args: { projectPath } });
}

export function gitDetectOrphans(projectPath: string, minAgeSeconds?: number | null) {
  return invoke<OrphanWorktree[]>("git_detect_orphans", {
    args: { projectPath, minAgeSeconds: minAgeSeconds ?? null },
  });
}

export function gitCleanupOrphans(projectPath: string, minAgeSeconds?: number | null) {
  return invoke<GitCleanupOrphansResponse>("git_cleanup_orphans", {
    args: { projectPath, minAgeSeconds: minAgeSeconds ?? null },
  });
}

export function gitBranches(projectPath: string) {
  return invoke<string[]>("git_branches", { args: { projectPath } });
}

export function gitDiff(projectPath: string, branch: string, baseBranch: string) {
  return invoke<FileDiff[]>("git_diff", { args: { projectPath, branch, baseBranch } });
}

export function gitMerge(projectPath: string, branch: string, baseBranch: string, strategy: MergeStrategy) {
  return invoke<GitMergeResult>("git_merge", {
    args: { projectPath, branch, baseBranch, strategy },
  });
}

export function reviewCreate(projectPath: string, sessionId: number, branch: string, baseBranch: string) {
  return invoke<ReviewItem>("review_create", { args: { projectPath, sessionId, branch, baseBranch } });
}

export function reviewList(projectPath: string) {
  return invoke<ReviewItem[]>("review_list", { args: { projectPath } });
}

export function reviewGet(projectPath: string, id: string) {
  return invoke<ReviewItem>("review_get", { args: { projectPath, id } });
}

export function reviewSetStatus(projectPath: string, id: string, status: ReviewStatus) {
  return invoke<ReviewItem>("review_set_status", { args: { projectPath, id, status } });
}

export function reviewSetDecision(projectPath: string, id: string, decision: ReviewDecision) {
  return invoke<ReviewItem>("review_set_decision", { args: { projectPath, id, decision } });
}

export function reviewSetMergeStrategy(projectPath: string, id: string, strategy: MergeStrategy) {
  return invoke<ReviewItem>("review_set_merge_strategy", { args: { projectPath, id, strategy } });
}

export function reviewAddComment(
  projectPath: string,
  id: string,
  filePath: string,
  lineNumber: number,
  body: string,
  author: string = "user",
) {
  return invoke<ReviewItem>("review_add_comment", { args: { projectPath, id, filePath, lineNumber, body, author } });
}

export function reviewResolveComment(projectPath: string, id: string, commentId: string, resolved: boolean) {
  return invoke<ReviewItem>("review_resolve_comment", { args: { projectPath, id, commentId, resolved } });
}

export async function onSessionOutput(
  handler: (payload: SessionOutputEvent) => void,
) {
  return listen<SessionOutputEvent>("session:output", (event) => handler(event.payload));
}

export async function onSessionCostUpdated(
  handler: (payload: SessionCostUpdatedEvent) => void,
) {
  return listen<SessionCostUpdatedEvent>("cost:updated", (event) => handler(event.payload));
}

export async function onSessionExit(handler: (payload: SessionExitEvent) => void) {
  return listen<SessionExitEvent>("session:exit", (event) => handler(event.payload));
}

export async function onGitEvent(handler: (payload: GitEvent) => void) {
  return listen<GitEvent>("git:event", (event) => handler(event.payload));
}

// -----------------------------------------------------------------------------
// Localhost sessions (Phase 4)
// -----------------------------------------------------------------------------

export function localhostSessionList(projectPath: string) {
  return invoke<LocalhostSessionView[]>("localhost_session_list", { args: { projectPath } });
}

export function localhostSessionUpsert(
  spec: Omit<LocalhostSessionSpec, "id" | "createdAt"> & { id?: string | null },
) {
  return invoke<LocalhostSessionView[]>("localhost_session_upsert", { args: { spec } });
}

export function localhostSessionDelete(projectPath: string, id: string) {
  return invoke<LocalhostSessionView[]>("localhost_session_delete", { args: { projectPath, id } });
}

export function localhostSessionStart(projectPath: string, id: string) {
  return invoke<LocalhostSessionView>("localhost_session_start", { args: { projectPath, id } });
}

export function localhostSessionStop(projectPath: string, id: string) {
  return invoke<LocalhostSessionView>("localhost_session_stop", { args: { projectPath, id } });
}

export function localhostSessionRestart(projectPath: string, id: string) {
  return invoke<LocalhostSessionView>("localhost_session_restart", { args: { projectPath, id } });
}

export function localhostSessionLogs(projectPath: string, id: string) {
  return invoke<string[]>("localhost_session_logs", { args: { projectPath, id } });
}

export async function onLocalhostSessionLog(handler: (payload: LocalhostSessionLogEvent) => void) {
  return listen<LocalhostSessionLogEvent>("localhost:log", (event) => handler(event.payload));
}

export async function onLocalhostSessionStatus(handler: (payload: LocalhostSessionStatusEvent) => void) {
  return listen<LocalhostSessionStatusEvent>("localhost:status", (event) => handler(event.payload));
}

export function skillsDiscover(projectPath?: string | null) {
  return invoke<SkillsDiscoveryResult>("skills_discover", {
    args: { projectPath: projectPath ?? null },
  });
}

export function skillsDiscoverForAgent(projectPath: string | null | undefined, agentType: string) {
  return invoke<SkillsDiscoveryResult>("skills_discover", {
    args: { projectPath: projectPath ?? null, agentType },
  });
}

export function skillsSetEnabled(
  name: string,
  enabled: boolean,
  path?: string | null,
  description?: string | null,
) {
  return invoke<void>("skills_set_enabled", {
    args: { name, enabled, path: path ?? null, description: description ?? null },
  });
}

export function skillsSetEnabledForAgent(
  agentType: string,
  name: string,
  enabled: boolean,
  path?: string | null,
  description?: string | null,
) {
  return invoke<void>("skills_set_enabled", {
    args: { agentType, name, enabled, path: path ?? null, description: description ?? null },
  });
}

export function mcpDiscover(projectPath?: string | null) {
  return invoke<McpDiscoveryResult>("mcp_discover", {
    args: { projectPath: projectPath ?? null },
  });
}

export function mcpDiscoverForAgent(projectPath: string | null | undefined, agentType: string) {
  return invoke<McpDiscoveryResult>("mcp_discover", {
    args: { projectPath: projectPath ?? null, agentType },
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

export function mcpSetEnabledForAgent(
  agentType: string,
  name: string,
  enabled: boolean,
  projectPath?: string | null,
  scope?: "global" | "project" | null,
) {
  return invoke<void>("mcp_set_enabled", {
    args: { agentType, name, enabled, projectPath: projectPath ?? null, scope: scope ?? null },
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
