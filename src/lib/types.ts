export type AgentType = "claude_code" | "gemini_cli" | "codex" | "terminal";

export type SessionId = number;

export interface DetectedAgent {
  agentType: AgentType;
  command: string;
  found: boolean;
  path?: string | null;
}

export type OrchestrationMode = "manual" | "gastown";

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: string;
  orchestrationMode: OrchestrationMode;
}

export interface SessionCreateArgs {
  agentType: AgentType;
  projectPath: string;
  branch?: string;
  workingDir?: string;
  env?: Record<string, string>;
}

export interface SessionCreateResponse {
  sessionId: SessionId;
  paneIndex: number;
  agentType: AgentType;
  warning?: string | null;
}

export interface SessionInfo {
  sessionId: SessionId;
  paneIndex: number;
  agentType: AgentType;
  projectPath: string;
  branch?: string;
  workingDir?: string;
}

export interface SessionOutputEvent {
  sessionId: SessionId;
  dataB64: string;
}

export interface SessionExitEvent {
  sessionId: SessionId;
  exitCode: number;
}
