import type { AgentType, SessionId, SessionInfo } from "../../lib/types";

type AgentStatusOverviewProps = {
  sessions: SessionInfo[];
  selectedSessionId: SessionId | null;
  onSelectSession: (sessionId: SessionId) => void;
};

function agentBadge(agentType: AgentType): { label: string; className: string } {
  switch (agentType) {
    case "claude_code":
      return { label: "Claude", className: "border-accent-purple/40 bg-accent-purple/10 text-accent-purple" };
    case "gemini_cli":
      return { label: "Gemini", className: "border-accent-blue/40 bg-accent-blue/10 text-accent-blue" };
    case "codex":
      return { label: "Codex", className: "border-accent-green/40 bg-accent-green/10 text-accent-green" };
    case "openrouter":
      return { label: "Router", className: "border-accent-orange/40 bg-accent-orange/10 text-accent-orange" };
    case "terminal":
      return { label: "Term", className: "border-border bg-bg-tertiary text-text-secondary" };
  }
}

export function AgentStatusOverview(props: AgentStatusOverviewProps) {
  const { sessions, selectedSessionId, onSelectSession } = props;

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-bg-secondary px-3 py-3 text-xs text-text-secondary">
        No active sessions.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sessions.map((s) => {
        const active = s.sessionId === selectedSessionId;
        const badge = agentBadge(s.agentType);
        return (
          <button
            key={s.sessionId}
            className={[
              "flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left",
              active ? "border-accent-blue/50 bg-bg-hover" : "border-border bg-bg-secondary hover:bg-bg-hover",
            ].join(" ")}
            onClick={() => onSelectSession(s.sessionId)}
            type="button"
            title="Select session"
          >
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-accent-green" title="running" />
              <div className="font-mono text-[11px] text-text-secondary">#{s.paneIndex + 1}</div>
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className={["rounded-md border px-1.5 py-0.5 text-[10px] font-semibold", badge.className].join(" ")}>
                  {badge.label}
                </div>
                <div className="truncate text-xs font-semibold text-text-primary">
                  {s.branch ?? "no-branch"}
                </div>
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-text-secondary">
                {s.workingDir ?? s.projectPath}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
