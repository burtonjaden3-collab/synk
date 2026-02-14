import type { AgentType } from "../../lib/types";

export type McpAgentTab = {
  id: AgentType;
  label: string;
  title: string;
};

export const MCP_AGENT_TABS: McpAgentTab[] = [
  { id: "claude_code", label: "Claude", title: "Claude MCP" },
  { id: "codex", label: "Codex", title: "Codex MCP" },
  { id: "openrouter", label: "OpenRouter", title: "OpenRouter MCP" },
];
