import { useMemo, useState } from "react";

import type { AgentType, RecentProject, SessionId, SessionInfo } from "../../lib/types";
import { AgentStatusOverview } from "./AgentStatusOverview";
import { McpManager } from "./McpManager";
import { MCP_AGENT_TABS } from "./mcp-agent-tabs";
import { ProjectSelector } from "./ProjectSelector";
import { SessionConfig } from "./SessionConfig";
import { SKILL_AGENT_TABS } from "./skill-agent-tabs";
import { SkillsBrowser } from "./SkillsBrowser";

type SidebarProps = {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  width?: number;
  maxSessions?: number;

  tauriAvailable: boolean;
  currentProject: RecentProject | null;
  recentProjects: RecentProject[];
  onOpenFolder: () => void;
  onSelectProject: (projectPath: string) => void;

  sessions: SessionInfo[];
  selectedSessionId: SessionId | null;
  onSelectSession: (sessionId: SessionId) => void;
  onRefreshSessions: () => void;
};

export function Sidebar(props: SidebarProps) {
  const {
    collapsed,
    onToggleCollapsed,
    width,
    maxSessions,
    tauriAvailable,
    currentProject,
    recentProjects,
    onOpenFolder,
    onSelectProject,
    sessions,
    selectedSessionId,
    onSelectSession,
    onRefreshSessions,
  } = props;

  const [configOpen, setConfigOpen] = useState(false);
  const [skillsAgentTab, setSkillsAgentTab] = useState<AgentType>("claude_code");
  const [mcpAgentTab, setMcpAgentTab] = useState<AgentType>("claude_code");
  const expandedWidth = Math.max(220, Math.min(520, width ?? 280));
  const maxSessionsLabel = maxSessions ?? 12;
  const activeSkillTab = useMemo(
    () => SKILL_AGENT_TABS.find((tab) => tab.id === skillsAgentTab) ?? SKILL_AGENT_TABS[0],
    [skillsAgentTab],
  );
  const activeMcpTab = useMemo(
    () => MCP_AGENT_TABS.find((tab) => tab.id === mcpAgentTab) ?? MCP_AGENT_TABS[0],
    [mcpAgentTab],
  );

  const selectedSession = useMemo(
    () => sessions.find((s) => s.sessionId === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  return (
    <aside
      className={[
        // Important: clip child content when collapsing to 0 width.
        "h-full overflow-hidden bg-[#181825] transition-[width] duration-200",
        // Leave a small rail visible so users can re-open without knowing the hotkey.
        "border-r border-border",
      ].join(" ")}
      style={{ width: collapsed ? 0 : expandedWidth }}
    >
      {collapsed ? null : (
        <div className="flex h-full flex-col overflow-hidden" style={{ width: expandedWidth }}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold tracking-wide text-text-primary">SIDEBAR</div>
              <div className="truncate font-mono text-[10px] text-text-secondary">Ctrl+e to collapse</div>
            </div>
            <button
              className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
              onClick={onToggleCollapsed}
              title="Collapse sidebar (Ctrl+e)"
              aria-label="Collapse sidebar"
              type="button"
            >
              {">"}
            </button>
          </div>

          <div className="relative flex-1 overflow-hidden">
            <div className="h-full overflow-auto px-3 py-3">
              <section>
                <div className="text-[11px] font-semibold tracking-[0.18em] text-text-secondary">PROJECT</div>
                <div className="mt-2">
                  <ProjectSelector
                    tauriAvailable={tauriAvailable}
                    currentProject={currentProject}
                    recentProjects={recentProjects}
                    onOpenFolder={onOpenFolder}
                    onSelectProject={onSelectProject}
                  />
                </div>
              </section>

              <div className="my-4 h-px bg-border/80" />

              <section>
                <div className="text-[11px] font-semibold tracking-[0.18em] text-text-secondary">SKILLS</div>
                <div className="mt-2">
                  <div className="rounded-xl border border-border bg-bg-secondary p-2">
                    <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-bg-tertiary p-1">
                      {SKILL_AGENT_TABS.map((tab) => {
                        const active = tab.id === activeSkillTab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setSkillsAgentTab(tab.id)}
                            className={[
                              "rounded-md px-2 py-1 text-[10px] font-semibold tracking-[0.08em] transition-colors",
                              active
                                ? "border border-accent-blue/45 bg-accent-blue/10 text-accent-blue"
                                : "border border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary",
                            ].join(" ")}
                            aria-pressed={active}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2">
                      <SkillsBrowser
                        key={activeSkillTab.id}
                        tauriAvailable={tauriAvailable}
                        projectPath={currentProject?.path ?? null}
                        agentType={activeSkillTab.id}
                        title={activeSkillTab.title}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <div className="my-4 h-px bg-border/80" />

              <section>
                <div className="text-[11px] font-semibold tracking-[0.18em] text-text-secondary">MCP</div>
                <div className="mt-2">
                  <div className="rounded-xl border border-border bg-bg-secondary p-2">
                    <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-bg-tertiary p-1">
                      {MCP_AGENT_TABS.map((tab) => {
                        const active = tab.id === activeMcpTab.id;
                        return (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setMcpAgentTab(tab.id)}
                            className={[
                              "rounded-md px-2 py-1 text-[10px] font-semibold tracking-[0.08em] transition-colors",
                              active
                                ? "border border-accent-blue/45 bg-accent-blue/10 text-accent-blue"
                                : "border border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary",
                            ].join(" ")}
                            aria-pressed={active}
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2">
                      <McpManager
                        key={activeMcpTab.id}
                        tauriAvailable={tauriAvailable}
                        projectPath={currentProject?.path ?? null}
                        agentType={activeMcpTab.id}
                        title={activeMcpTab.title}
                        allowToggle={activeMcpTab.id === "claude_code"}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <div className="my-4 h-px bg-border/80" />

              <section>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold tracking-[0.18em] text-text-secondary">SESSIONS</div>
                  <div className="font-mono text-[10px] text-text-secondary">{sessions.length}/{maxSessionsLabel}</div>
                </div>
                <div className="mt-2">
                  <AgentStatusOverview
                    sessions={sessions}
                    selectedSessionId={selectedSessionId}
                    onSelectSession={(sid) => {
                      onSelectSession(sid);
                      setConfigOpen(true);
                    }}
                  />
                </div>
              </section>
            </div>

            <div
              className={[
                "absolute inset-0 border-l border-border bg-[#181825] transition-transform duration-200",
                configOpen ? "translate-x-0" : "translate-x-full",
              ].join(" ")}
            >
              <SessionConfig
                tauriAvailable={tauriAvailable}
                projectPath={currentProject?.path ?? null}
                session={selectedSession}
                open={configOpen}
                onClose={() => setConfigOpen(false)}
                onRefreshSessions={onRefreshSessions}
              />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
