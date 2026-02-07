import { useEffect, useMemo, useRef, useState } from "react";

import { onSessionExit, onSessionOutput, sessionCreate, sessionDestroy, sessionList } from "../../lib/tauri-api";
import type { AgentType, SessionExitEvent, SessionInfo, SessionOutputEvent } from "../../lib/types";
import { SessionGrid } from "./SessionGrid";

type OutputHandler = (dataB64: string) => void;

export function Workspace() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [projectPath, setProjectPath] = useState(".");
  const [agentType, setAgentType] = useState<AgentType>("terminal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const outputHandlersRef = useRef<Map<number, OutputHandler>>(new Map());

  const refreshSessions = async () => {
    const list = await sessionList();
    setSessions(list);
  };

  useEffect(() => {
    refreshSessions().catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    let unlistenOutput: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    onSessionOutput((payload: SessionOutputEvent) => {
      const h = outputHandlersRef.current.get(payload.sessionId);
      if (!h) return;
      h(payload.dataB64);
    }).then((fn) => {
      unlistenOutput = fn;
    });

    onSessionExit((payload: SessionExitEvent) => {
      // Keep it simple for Phase 1: refresh the list when a session exits.
      refreshSessions().catch(() => {});
      // Also allow panes to show a local marker if they want.
      const h = outputHandlersRef.current.get(payload.sessionId);
      if (h) h(btoa(`\r\n[session exited: ${payload.exitCode}]\r\n`));
    }).then((fn) => {
      unlistenExit = fn;
    });

    return () => {
      unlistenOutput?.();
      unlistenExit?.();
    };
  }, []);

  const sessionCount = sessions.length;
  const canAdd = useMemo(() => sessionCount < 12 && !busy, [sessionCount, busy]);

  return (
    <div className="flex h-full min-h-full flex-col bg-bg-primary text-text-primary">
      <div className="flex h-14 items-center gap-3 border-b border-border bg-bg-secondary px-4">
        <div className="text-sm font-semibold tracking-tight">Synk</div>
        <div className="h-5 w-px bg-border" />
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          Project
          <input
            className="h-9 w-64 rounded-lg border border-border bg-bg-primary px-3 text-sm text-text-primary"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          Agent
          <select
            className="h-9 rounded-lg border border-border bg-bg-primary px-2 text-sm text-text-primary"
            value={agentType}
            onChange={(e) => setAgentType(e.target.value as AgentType)}
          >
            <option value="terminal">terminal</option>
            <option value="claude_code">claude_code</option>
            <option value="gemini_cli">gemini_cli</option>
            <option value="codex">codex</option>
          </select>
        </label>
        <button
          className="ml-2 h-9 rounded-lg border border-border bg-bg-primary px-3 text-sm font-medium disabled:opacity-50"
          disabled={!canAdd}
          onClick={async () => {
            setError(null);
            setBusy(true);
            try {
              await sessionCreate({ agentType, projectPath });
              await refreshSessions();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Add Session
        </button>
        <button
          className="h-9 rounded-lg border border-border bg-bg-primary px-3 text-sm font-medium disabled:opacity-50"
          disabled={busy}
          onClick={async () => {
            setError(null);
            setBusy(true);
            try {
              await refreshSessions();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Refresh
        </button>
        <div className="ml-auto text-xs text-text-secondary">
          {sessionCount}/12 sessions
        </div>
      </div>

      {error ? (
        <div className="border-b border-border bg-bg-tertiary px-4 py-2 text-sm text-accent-red">
          {error}
        </div>
      ) : null}

      <div className="flex-1 p-4">
        <SessionGrid
          sessions={sessions}
          registerOutputHandler={(sessionId, handler) => {
            outputHandlersRef.current.set(sessionId, handler);
          }}
          unregisterOutputHandler={(sessionId) => {
            outputHandlersRef.current.delete(sessionId);
          }}
          onDestroySession={async (sessionId) => {
            setError(null);
            setBusy(true);
            try {
              await sessionDestroy(sessionId);
              await refreshSessions();
            } catch (e) {
              setError(String(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
    </div>
  );
}

