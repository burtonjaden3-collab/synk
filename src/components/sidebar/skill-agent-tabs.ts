import type { AgentType } from "../../lib/types";

export type SkillAgentTab = {
  id: AgentType;
  label: string;
  title: string;
};

export const SKILL_AGENT_TABS: SkillAgentTab[] = [
  { id: "claude_code", label: "Claude", title: "Claude Skills" },
  { id: "codex", label: "Codex", title: "Codex Skills" },
  { id: "openrouter", label: "OpenRouter", title: "OpenRouter Skills" },
];
