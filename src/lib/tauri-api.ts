import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  DetectedAgent,
  RecentProject,
  SessionCreateArgs,
  SessionCreateResponse,
  SessionExitEvent,
  SessionId,
  SessionInfo,
  SessionOutputEvent,
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
