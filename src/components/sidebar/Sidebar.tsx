import { useMemo, useState } from "react";

import type { OrchestrationMode, RecentProject, SessionId, SessionInfo } from "../../lib/types";
import { AgentStatusOverview } from "./AgentStatusOverview";
import { McpManager } from "./McpManager";
import { OrchestratorControls } from "./OrchestratorControls";
import { ProjectSelector } from "./ProjectSelector";
import { SessionConfig } from "./SessionConfig";
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

  orchestrationMode: OrchestrationMode;
  onChangeOrchestrationMode: (mode: OrchestrationMode) => void;

  sessions: SessionInfo[];
  selectedSessionId: SessionId | null;
  onSelectSession: (sessionId: SessionId) => void;
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
    orchestrationMode,
    onChangeOrchestrationMode,
    sessions,
    selectedSessionId,
    onSelectSession,
  } = props;

  const [configOpen, setConfigOpen] = useState(false);
  const expandedWidth = Math.max(220, Math.min(520, width ?? 280));
  const maxSessionsLabel = maxSessions ?? 12;

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
              <div className="text-[11px] font-semibold tracking-[0.18em] text-text-secondary">ORCHESTRATOR</div>
              <div className="mt-2">
                <OrchestratorControls value={orchestrationMode} onChange={onChangeOrchestrationMode} />
              </div>
            </section>

            <div className="my-4 h-px bg-border/80" />

            <section>
              <div className="text-[11px] font-semibold tracking-[0.18em] text-text-secondary">SKILLS</div>
              <div className="mt-2">
                <SkillsBrowser tauriAvailable={tauriAvailable} projectPath={currentProject?.path ?? null} />
              </div>
            </section>

            <div className="my-4 h-px bg-border/80" />

            <section>
              <div className="text-[11px] font-semibold tracking-[0.18em] text-text-secondary">MCP</div>
              <div className="mt-2">
                <McpManager tauriAvailable={tauriAvailable} projectPath={currentProject?.path ?? null} />
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
              />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
