import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import type {
  SessionCreateArgs,
  SessionCreateResponse,
  SessionExitEvent,
  SessionId,
  SessionInfo,
  SessionOutputEvent,
} from "./types";

export function sessionCreate(args: SessionCreateArgs) {
  return invoke<SessionCreateResponse>(
    "session:create",
    args as unknown as Record<string, unknown>,
  );
}

export function sessionDestroy(sessionId: SessionId) {
  return invoke<{ success: boolean }>("session:destroy", { sessionId });
}

export function sessionWrite(sessionId: SessionId, data: string) {
  return invoke<void>("session:write", { sessionId, data });
}

export function sessionResize(sessionId: SessionId, cols: number, rows: number) {
  return invoke<void>("session:resize", { sessionId, cols, rows });
}

export function sessionList() {
  return invoke<SessionInfo[]>("session:list");
}

export async function onSessionOutput(
  handler: (payload: SessionOutputEvent) => void,
) {
  return listen<SessionOutputEvent>("session:output", (event) => handler(event.payload));
}

export async function onSessionExit(handler: (payload: SessionExitEvent) => void) {
  return listen<SessionExitEvent>("session:exit", (event) => handler(event.payload));
}
