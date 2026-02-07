export type AgentType = "claude_code" | "gemini_cli" | "codex" | "terminal";

export type SessionId = number;

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

