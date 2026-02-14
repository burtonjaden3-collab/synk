export type AgentType = "claude_code" | "gemini_cli" | "codex" | "openrouter" | "terminal";
export type CodexProvider = "openai" | "openrouter";

export type SessionId = number;

export interface DetectedAgent {
  agentType: AgentType;
  command: string;
  found: boolean;
  path?: string | null;
  version?: string | null;
}

// Keep this aligned with the sidebar UI. Backend persistence currently defaults to "manual".
export type OrchestrationMode = "manual" | "gastown" | "agent_teams";

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
  model?: string;
  codexProvider?: CodexProvider;
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
  codexProvider?: CodexProvider;
  model?: string;
  projectPath: string;
  branch?: string;
  workingDir?: string;
  cost?: SessionCostSnapshot | null;
}

export type SessionCostSource = "mcp" | "output_parsed" | "heuristic";

export interface SessionCostSnapshot {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  model?: string | null;
  source: SessionCostSource;
}

export interface SessionCostUpdatedEvent {
  sessionId: SessionId;
  cost: SessionCostSnapshot;
}

export interface SessionOutputEvent {
  sessionId: SessionId;
  dataB64: string;
}

export interface SessionExitEvent {
  sessionId: SessionId;
  exitCode: number;
}

export interface SessionScrollbackResponse {
  dataB64: string;
}

export type SkillSource = "settings" | "directory" | "config";

export interface SkillInfo {
  name: string;
  path: string;
  enabled: boolean;
  description?: string | null;
  source: SkillSource;
  exists: boolean;
}

export interface SkillsDiscoveryResult {
  installed: SkillInfo[];
  recommended: string[];
  settingsPath: string;
}

export type McpServerSource = "global" | "project" | "process" | "codex";
export type McpServerStatus = "connected" | "starting" | "disconnected" | "disabled";

export interface McpRunningProcess {
  pid: number;
  cmdline: string;
}

export interface McpServerInfo {
  name: string;
  command?: string | null;
  args: string[];
  envKeys: string[];
  enabled: boolean;
  source: McpServerSource;
  configured: boolean;
  running: boolean;
  pid?: number | null;
  cmdline?: string | null;
  status: McpServerStatus;
}

export interface McpDiscoveryResult {
  servers: McpServerInfo[];
  globalConfigPath: string;
  projectConfigPath?: string | null;
  runningProcesses: McpRunningProcess[];
}

export interface SessionConfigDisk {
  agentType?: AgentType | null;
  branch?: string | null;
  worktreeIsolation?: boolean | null;
  skills?: string[];
  mcpServers?: string[];
}

export interface ProjectConfigView {
  projectPath: string;
  configPath: string;
  sessions: Record<string, SessionConfigDisk>;
}

// -----------------------------------------------------------------------------
// Localhost sessions (Phase 4)
// -----------------------------------------------------------------------------

export type LocalhostSessionType = "web" | "desktop";
export type LocalhostPortMode = "auto" | "manual";
export type LocalhostSessionStatus = "stopped" | "starting" | "running" | "exited";

export interface LocalhostSessionSpec {
  id: string;
  projectPath: string;
  workingDir: string;
  sourceLabel: string; // e.g. "main" or "feat/phase4"
  type: LocalhostSessionType;
  portMode: LocalhostPortMode;
  preferredPort?: number | null;
  autoInstallDeps: boolean;
  createdAt?: string | null;
}

export interface LocalhostSessionView extends LocalhostSessionSpec {
  status: LocalhostSessionStatus;
  port?: number | null;
  pid?: number | null;
  url?: string | null;
  lastExitCode?: number | null;
  cmdline?: string | null;
}

export interface LocalhostSessionLogEvent {
  projectPath: string;
  id: string;
  stream: "stdout" | "stderr";
  line: string;
  timestamp: string; // RFC3339
}

export interface LocalhostSessionStatusEvent {
  projectPath: string;
  id: string;
  status: LocalhostSessionStatus;
  port?: number | null;
  pid?: number | null;
  url?: string | null;
  lastExitCode?: number | null;
}

// -----------------------------------------------------------------------------
// Git (Phase 3A)
// -----------------------------------------------------------------------------

export interface GitCreateWorktreeResponse {
  worktreePath: string;
  branch: string;
}

export interface WorktreeInfo {
  path: string;
  head?: string | null;
  branch?: string | null;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  isSynkManaged: boolean;
}

export interface OrphanWorktree {
  info: WorktreeInfo;
  ageSeconds: number;
}

export interface GitCleanupOrphansResponse {
  removed: string[];
  failed: string[];
}

export type GitEventType =
  | "commit"
  | "branch_created"
  | "branch_deleted"
  | "merge_completed"
  | "conflict_detected";

export interface GitEvent {
  id: string;
  eventType: GitEventType;
  timestamp: string; // RFC3339
  projectPath: string;
  sessionId?: number | null;
  branch?: string | null;
  hash?: string | null;
  message?: string | null;
  author?: string | null;
  baseBranch?: string | null;
  strategy?: string | null;
  conflictFiles?: string[] | null;
}

export type FileDiffStatus = "added" | "modified" | "deleted" | "renamed";
export type DiffLineType = "context" | "addition" | "deletion";

export interface DiffLine {
  type: DiffLineType;
  lineNumber: number; // line number in the new file
  content: string;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  path: string;
  status: FileDiffStatus;
  oldPath?: string | null;
  hunks: DiffHunk[];
}

export interface GitMergeResult {
  success: boolean;
  conflictFiles?: string[] | null;
}

export type ReviewStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "merging"
  | "merged"
  | "merge_conflict";

export type ReviewDecision = "approved" | "rejected" | "changes_requested";

export interface ReviewComment {
  id: string;
  filePath: string;
  lineNumber: number;
  body: string;
  author: "user" | "agent" | string;
  createdAt: string;
  resolved: boolean;
}

export interface ReviewItem {
  id: string;
  taskId?: string | null;
  sessionId: number;
  branch: string;
  baseBranch: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  files: FileDiff[];
  comments: ReviewComment[];
  reviewDecision?: ReviewDecision | null;
  mergeStrategy?: MergeStrategy | null;
}

export type SessionSnapshotKind = "named" | "autosave";

export interface GridLayoutSnapshot {
  sessionCount: number;
  layout: string; // e.g. "2x2"
}

export interface SessionPaneSnapshot {
  paneIndex: number;
  agentType: AgentType;
  branch?: string | null;
  worktreeEnabled: boolean;
  workingDir: string;
  skills: string[];
  mcpServers: string[];
  envOverrides: Record<string, string>;
}

export interface SessionSnapshot {
  version: number;
  name: string;
  savedAt: string;
  projectPath: string;
  orchestrationMode: OrchestrationMode;
  gridLayout: GridLayoutSnapshot;
  sessions: SessionPaneSnapshot[];
  taskQueueSnapshot: unknown[];
}

export interface SessionSnapshotMeta {
  id: string; // filename stem
  name: string;
  kind: SessionSnapshotKind;
  path: string;
  savedAt: string;
  projectPath: string;
  sessionCount: number;
  layout: string;
}

// -----------------------------------------------------------------------------
// Settings (Task 2.5)
// -----------------------------------------------------------------------------

export type SettingsAuthMode = "apiKey" | "oauth";

export type AiProviderId = "anthropic" | "google" | "openai" | "openrouter" | "ollama";

export interface ProviderAuthSettings {
  authMode?: SettingsAuthMode | null;
  apiKey?: string | null;
  oauthConnected: boolean;
  oauthEmail?: string | null;
  defaultModel: string;
}

export interface OllamaSettings {
  baseUrl: string;
  defaultModel: string;
}

export interface AiProvidersSettings {
  default: AiProviderId;
  anthropic: ProviderAuthSettings;
  google: ProviderAuthSettings;
  openai: ProviderAuthSettings;
  openrouter: ProviderAuthSettings;
  ollama: OllamaSettings;
}

export interface PerformanceSettings {
  initialPoolSize: number;
  maxPoolSize: number;
  maxActiveSessions: number;
  recycleEnabled: boolean;
  maxPtyAgeMinutes: number;
  warmupDelayMs: number;
  pollIntervalMs: number;
}

export type TerminalExitMethod = "double_escape" | "ctrl_backslash" | "ctrl_shift_escape";

export interface KeyboardSettings {
  terminalExitMethod: TerminalExitMethod;
  doubleEscapeTimeoutMs: number;
  customBindings: Record<string, unknown>;
}

export interface UiSettings {
  sidebarWidth: number;
  drawerHeight: number;
  drawerPanelOrder: string[];
  showSessionCostInHeader: boolean;
  dimUnfocusedPanes: boolean;
  unfocusedOpacity: number;
}

export type ToastPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left";

export interface NotificationsSettings {
  taskCompleted: boolean;
  agentError: boolean;
  mergeConflict: boolean;
  reviewReady: boolean;
  costThreshold?: number | null;
  position: ToastPosition;
  durationMs: number;
}

export type MergeStrategy = "merge" | "squash" | "rebase";

export interface GitSettings {
  defaultMergeStrategy: MergeStrategy;
  autoDelegateConflicts: boolean;
  worktreeBasePath: string;
  branchPrefix: string;
}

export interface SessionSettings {
  autoSave: boolean;
  autoSaveIntervalSeconds: number;
}

export interface GastownSettings {
  cliPath?: string | null;
  workspacePath: string;
  pinnedVersion: string;
}

export interface AppSettings {
  version: number;
  aiProviders: AiProvidersSettings;
  performance: PerformanceSettings;
  keyboard: KeyboardSettings;
  ui: UiSettings;
  notifications: NotificationsSettings;
  git: GitSettings;
  session: SessionSettings;
  gastown: GastownSettings;
}

export interface ProviderKeyValidationResult {
  ok: boolean;
  message: string;
  statusCode?: number | null;
}

export interface ProviderModelsResult {
  ok: boolean;
  models: string[];
  message: string;
  statusCode?: number | null;
}

export interface OllamaPullResult {
  ok: boolean;
  model: string;
  message: string;
}

// -----------------------------------------------------------------------------
// Onboarding (Task 2.6)
// -----------------------------------------------------------------------------

export interface OnboardingScanResult {
  agents: DetectedAgent[];
  gtFound: boolean;
  gtPath?: string | null;
  gastownWorkspacePath: string;
  gastownWorkspaceFound: boolean;
}
