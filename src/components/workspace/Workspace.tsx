import { useEffect, useMemo, useRef, useState } from "react";

import {
  agentsList,
  onSessionExit,
  onSessionOutput,
  sessionCreate,
  sessionDestroy,
  sessionList,
  sessionWrite,
} from "../../lib/tauri-api";
import type { AgentType, DetectedAgent, SessionExitEvent, SessionInfo, SessionOutputEvent } from "../../lib/types";
import { useAppStore } from "../../lib/store";
import {
  gridForCount,
  isEditableTarget,
  keyEventToPrintableChar,
  keyToSessionIndex,
  moveIndex,
  stopEvent,
  type Direction,
  type InputMode,
} from "../../lib/keybindings";
import { SessionGrid } from "./SessionGrid";

type OutputHandler = (dataB64: string) => void;

function isTauriRuntime(): boolean {
  // Vite `npm run dev` runs in a normal browser context (no Tauri backend).
  // Avoid calling `invoke()` in that mode, otherwise you'll get "command ... not found".
  const w = globalThis as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return !!(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

export function Workspace() {
  const currentProject = useAppStore((s) => s.currentProject);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [projectPath, setProjectPath] = useState(() => currentProject?.path ?? ".");
  const [agentType, setAgentType] = useState<AgentType>("terminal");
  const [detectedAgents, setDetectedAgents] = useState<Record<AgentType, DetectedAgent> | null>(null);
  const [mode, setMode] = useState<InputMode>("navigation");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tauriAvailable = useMemo(() => isTauriRuntime(), []);

  const outputHandlersRef = useRef<Map<number, OutputHandler>>(new Map());
  const escapeTimerRef = useRef<number | null>(null);

  const refreshSessions = async () => {
    const list = await sessionList();
    setSessions(list);
  };

  useEffect(() => {
    if (!tauriAvailable) {
      // Keep the app usable for UI iteration in the browser.
      setSessions([]);
      setError(null);
      setNotice("Browser preview mode: run `npm run tauri dev` (not `npm run dev`) to enable sessions.");
      return;
    }
    setNotice(null);
    refreshSessions().catch((e) => setError(String(e)));
  }, [tauriAvailable]);

  useEffect(() => {
    if (!tauriAvailable) return;
    agentsList()
      .then((list) => {
        const map: Partial<Record<AgentType, DetectedAgent>> = {};
        for (const a of list) map[a.agentType] = a;
        setDetectedAgents(map as Record<AgentType, DetectedAgent>);
      })
      .catch(() => {
        // Detection is optional in Phase 1; session creation will still work.
        setDetectedAgents(null);
      });
  }, [tauriAvailable]);

  useEffect(() => {
    if (currentProject?.path) setProjectPath(currentProject.path);
  }, [currentProject?.path]);

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => a.paneIndex - b.paneIndex),
    [sessions],
  );

  useEffect(() => {
    if (orderedSessions.length === 0) {
      if (mode !== "navigation") setMode("navigation");
      if (activeSessionId !== null) setActiveSessionId(null);
      if (selectedSessionId !== null) setSelectedSessionId(null);
      return;
    }

    if (selectedSessionId === null || !orderedSessions.some((s) => s.sessionId === selectedSessionId)) {
      setSelectedSessionId(orderedSessions[0].sessionId);
    }

    if (mode === "terminal") {
      if (activeSessionId === null || !orderedSessions.some((s) => s.sessionId === activeSessionId)) {
        setMode("navigation");
        setActiveSessionId(null);
      }
    }
  }, [orderedSessions, selectedSessionId, activeSessionId, mode]);

  useEffect(() => {
    if (mode === "navigation") {
      if (escapeTimerRef.current !== null) {
        window.clearTimeout(escapeTimerRef.current);
        escapeTimerRef.current = null;
      }
      if (activeSessionId !== null) setActiveSessionId(null);
    }
  }, [mode, activeSessionId]);

  useEffect(() => {
    if (!tauriAvailable) return;

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
  }, [tauriAvailable]);

  useEffect(() => {
    if (!tauriAvailable) return;

    const handler = (e: KeyboardEvent) => {
      if (orderedSessions.length === 0) return;

      // Always intercept Ctrl+b (reserved for future broadcast).
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "b") {
        stopEvent(e);
        return;
      }

      if (mode === "navigation") {
        if (isEditableTarget(e.target)) return;

        const idxFromNumber = keyToSessionIndex(e.key);
        if (idxFromNumber !== null) {
          const next = idxFromNumber < orderedSessions.length ? orderedSessions[idxFromNumber] : null;
          if (next) {
            stopEvent(e);
            setSelectedSessionId(next.sessionId);
          }
          return;
        }

        const key = e.key.toLowerCase();
        const dir: Direction | null =
          key === "h" ? "left" : key === "l" ? "right" : key === "k" ? "up" : key === "j" ? "down" : null;
        if (dir) {
          stopEvent(e);
          const { cols } = gridForCount(orderedSessions.length);
          const currentIndex = Math.max(
            0,
            orderedSessions.findIndex((s) => s.sessionId === selectedSessionId),
          );
          const nextIndex = moveIndex(currentIndex, dir, cols, orderedSessions.length);
          setSelectedSessionId(orderedSessions[nextIndex].sessionId);
          return;
        }

        if (e.key === "Enter") {
          stopEvent(e);
          const sid = selectedSessionId ?? orderedSessions[0].sessionId;
          setSelectedSessionId(sid);
          setActiveSessionId(sid);
          setMode("terminal");
          return;
        }

        return;
      }

      // Terminal mode.
      const sid = activeSessionId ?? selectedSessionId;
      if (!sid) return;

      if (e.key === "Escape") {
        stopEvent(e);

        if (escapeTimerRef.current !== null) {
          window.clearTimeout(escapeTimerRef.current);
          escapeTimerRef.current = null;
          setMode("navigation");
          setActiveSessionId(null);
          return;
        }

        escapeTimerRef.current = window.setTimeout(() => {
          escapeTimerRef.current = null;
          sessionWrite(sid, "\x1b").catch(() => {});
        }, 300);
        return;
      }

      if (escapeTimerRef.current !== null) {
        // Escape followed by another key: flush ESC immediately, and for simple
        // printable keys, also forward the key ourselves so xterm doesn't double-send.
        window.clearTimeout(escapeTimerRef.current);
        escapeTimerRef.current = null;

        sessionWrite(sid, "\x1b").catch(() => {});
        const ch = keyEventToPrintableChar(e);
        if (ch) {
          stopEvent(e);
          sessionWrite(sid, ch).catch(() => {});
        }
      }
    };

    window.addEventListener("keydown", handler, true);
    return () => {
      if (escapeTimerRef.current !== null) {
        window.clearTimeout(escapeTimerRef.current);
        escapeTimerRef.current = null;
      }
      window.removeEventListener("keydown", handler, true);
    };
  }, [tauriAvailable, orderedSessions, mode, selectedSessionId, activeSessionId]);

  const sessionCount = orderedSessions.length;
  const canAdd = useMemo(() => sessionCount < 12 && !busy, [sessionCount, busy]);

  return (
    <div className="flex h-full min-h-full flex-col bg-bg-primary text-text-primary">
      <div className="flex h-14 items-center gap-3 border-b border-border bg-bg-secondary px-4">
        <div className="text-sm font-semibold tracking-tight">Synk</div>
        <div className="h-5 w-px bg-border" />
        <button
          className="h-9 rounded-lg border border-border bg-bg-primary px-3 text-sm font-medium text-text-secondary hover:bg-bg-hover"
          onClick={() => setCurrentProject(null)}
          title="Back to Home"
        >
          Home
        </button>
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
            <option value="claude_code">
              claude_code{detectedAgents && !detectedAgents.claude_code?.found ? " (missing)" : ""}
            </option>
            <option value="gemini_cli">
              gemini_cli{detectedAgents && !detectedAgents.gemini_cli?.found ? " (missing)" : ""}
            </option>
            <option value="codex">
              codex{detectedAgents && !detectedAgents.codex?.found ? " (missing)" : ""}
            </option>
          </select>
        </label>
        <button
          className="ml-2 h-9 rounded-lg border border-border bg-bg-primary px-3 text-sm font-medium disabled:opacity-50"
          disabled={!tauriAvailable || !canAdd}
          onClick={async () => {
            setError(null);
            setNotice(null);
            setBusy(true);
            try {
              const resp = await sessionCreate({ agentType, projectPath });
              if (resp.warning) {
                setNotice(resp.warning);
              }
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
          disabled={!tauriAvailable || busy}
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
          {currentProject ? (
            <span className="font-mono">{currentProject.name}</span>
          ) : null}
          {currentProject ? <span className="mx-2 text-border">·</span> : null}
          {sessionCount}/12 sessions
        </div>
      </div>

      {error ? (
        <div className="border-b border-border bg-bg-tertiary px-4 py-2 text-sm text-accent-red">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="border-b border-border bg-bg-tertiary px-4 py-2 text-sm text-text-secondary">
          {notice}
        </div>
      ) : null}

      <div className="flex-1 p-4">
        <SessionGrid
          sessions={orderedSessions}
          mode={mode}
          selectedSessionId={selectedSessionId}
          activeSessionId={activeSessionId}
          onSelectSession={(sessionId) => {
            setSelectedSessionId(sessionId);
            if (mode === "terminal") {
              setActiveSessionId(sessionId);
            }
          }}
          onActivateSession={(sessionId) => {
            setSelectedSessionId(sessionId);
            setActiveSessionId(sessionId);
            setMode("terminal");
          }}
          onExitToNav={(sessionId) => {
            setSelectedSessionId(sessionId);
            setActiveSessionId(null);
            setMode("navigation");
          }}
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
