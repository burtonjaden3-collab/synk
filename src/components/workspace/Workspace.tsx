import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauri } from "@tauri-apps/api/core";

import {
  agentsList,
  projectConfigGet,
  projectSessionConfigSet,
  onSessionExit,
  onSessionOutput,
  persistenceListRecentProjects,
  persistenceOpenProject,
  sessionCreate,
  sessionDestroy,
  sessionList,
  sessionSnapshotLoad,
  sessionSnapshotSaveAutosave,
  sessionSnapshotSaveNamed,
  sessionWrite,
} from "../../lib/tauri-api";
import type {
  AgentType,
  DetectedAgent,
  OrchestrationMode,
  RecentProject,
  SessionExitEvent,
  SessionId,
  SessionInfo,
  SessionOutputEvent,
} from "../../lib/types";
import { useAppStore } from "../../lib/store";
import {
  gridForCount,
  isSidebarToggle,
  isEditableTarget,
  keyEventToPrintableChar,
  keyToSessionIndex,
  moveIndex,
  stopEvent,
  type Direction,
  type InputMode,
} from "../../lib/keybindings";
import { SessionGrid } from "./SessionGrid";
import { Sidebar } from "../sidebar/Sidebar";

type OutputHandler = (dataB64: string) => void;

export function Workspace() {
  const currentProject = useAppStore((s) => s.currentProject);
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const setProjectConfig = useAppStore((s) => s.setProjectConfig);
  const pendingSessionRestoreId = useAppStore((s) => s.pendingSessionRestoreId);
  const setPendingSessionRestoreId = useAppStore((s) => s.setPendingSessionRestoreId);
  const settings = useAppStore((s) => s.settings);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [projectPath, setProjectPath] = useState(() => currentProject?.path ?? ".");
  const [agentType, setAgentType] = useState<AgentType>("terminal");
  const [detectedAgents, setDetectedAgents] = useState<Record<AgentType, DetectedAgent> | null>(null);
  const [mode, setMode] = useState<InputMode>("navigation");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [orchestrationMode, setOrchestrationMode] = useState<OrchestrationMode>(
    currentProject?.orchestrationMode ?? "manual",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tauriAvailable = useMemo(() => isTauri(), []);

  const outputHandlersRef = useRef<Map<number, OutputHandler>>(new Map());
  const escapeTimerRef = useRef<number | null>(null);
  const autosaveInFlightRef = useRef(false);
  const autosaveDebounceRef = useRef<number | null>(null);

  const refreshSessions = async () => {
    const list = await sessionList();
    setSessions(list);
  };

  const refreshRecentProjects = async () => {
    const list = await persistenceListRecentProjects();
    setRecentProjects(list);
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
    refreshRecentProjects().catch(() => {});
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

  useEffect(() => {
    if (!tauriAvailable) return;
    if (!currentProject?.path) {
      setProjectConfig(null);
      return;
    }
    projectConfigGet(currentProject.path)
      .then((cfg) => setProjectConfig(cfg))
      .catch(() => setProjectConfig(null));
  }, [tauriAvailable, currentProject?.path, setProjectConfig]);

  useEffect(() => {
    if (currentProject?.orchestrationMode) {
      setOrchestrationMode(currentProject.orchestrationMode);
    }
  }, [currentProject?.orchestrationMode]);

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => a.paneIndex - b.paneIndex),
    [sessions],
  );

  const effectiveProjectPath = useMemo(
    () => currentProject?.path ?? projectPath,
    [currentProject?.path, projectPath],
  );

  const autoSaveEnabled = settings?.session?.autoSave ?? true;
  const autoSaveIntervalMs = (settings?.session?.autoSaveIntervalSeconds ?? 60) * 1000;
  const exitMethod = settings?.keyboard?.terminalExitMethod ?? "double_escape";
  const doubleEscapeTimeoutMs = settings?.keyboard?.doubleEscapeTimeoutMs ?? 300;
  const dimUnfocused = settings?.ui?.dimUnfocusedPanes ?? true;
  const dimOpacity = settings?.ui?.unfocusedOpacity ?? 0.7;
  const sidebarWidth = settings?.ui?.sidebarWidth ?? 280;
  const models = settings?.aiProviders ?? null;

  const modelForAgent = useMemo(() => {
    return (t: AgentType): string | undefined => {
      if (!models) return undefined;
      switch (t) {
        case "claude_code":
          return models.anthropic.defaultModel || undefined;
        case "gemini_cli":
          return models.google.defaultModel || undefined;
        case "codex":
          return models.openai.defaultModel || undefined;
        case "terminal":
        default:
          return undefined;
      }
    };
  }, [models]);

  // If HomeScreen asked for a restore, do it immediately on entry.
  useEffect(() => {
    if (!tauriAvailable) return;
    if (!pendingSessionRestoreId) return;
    if (!effectiveProjectPath) return;

    let cancelled = false;

    (async () => {
      setError(null);
      setNotice(`Restoring session "${pendingSessionRestoreId}"...`);
      setBusy(true);

      const snap = await sessionSnapshotLoad(pendingSessionRestoreId);
      if (cancelled) return;
      if (snap.projectPath !== effectiveProjectPath) {
        throw new Error(
          `Snapshot projectPath mismatch: ${snap.projectPath} (snapshot) vs ${effectiveProjectPath} (current)`,
        );
      }

      // Clear any existing sessions (should usually be empty on fresh launch).
      const existing = await sessionList();
      for (const s of existing) {
        try {
          await sessionDestroy(s.sessionId);
        } catch {
          // Best-effort; proceed with restore.
        }
      }

      const panes = [...snap.sessions].sort((a, b) => a.paneIndex - b.paneIndex);
      for (const p of panes) {
        const resp = await sessionCreate({
          agentType: p.agentType,
          projectPath: snap.projectPath,
          branch: p.branch ?? undefined,
          workingDir: p.workingDir,
          model: modelForAgent(p.agentType),
        });

        // Persist per-pane config so SessionConfig panel reflects restored overrides.
        await projectSessionConfigSet(snap.projectPath, resp.paneIndex, {
          agentType: p.agentType,
          branch: p.branch ?? null,
          worktreeIsolation: p.worktreeEnabled,
          skills: p.skills ?? [],
          mcpServers: p.mcpServers ?? [],
        });
      }

      await refreshSessions();
      if (cancelled) return;

      setNotice(`Session restored: ${panes.length} panes`);
      setPendingSessionRestoreId(null);
    })()
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setNotice(null);
        setPendingSessionRestoreId(null);
      })
      .finally(() => {
        if (cancelled) return;
        setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    tauriAvailable,
    pendingSessionRestoreId,
    effectiveProjectPath,
    setPendingSessionRestoreId,
  ]);

  // Auto-save every 60s while sessions exist.
  useEffect(() => {
    if (!tauriAvailable) return;
    if (!effectiveProjectPath) return;
    if (orderedSessions.length === 0) return;
    if (!autoSaveEnabled) return;

    const tick = async () => {
      if (autosaveInFlightRef.current) return;
      autosaveInFlightRef.current = true;
      try {
        await sessionSnapshotSaveAutosave(effectiveProjectPath, orchestrationMode);
      } catch {
        // Ignore: autosave is best-effort.
      } finally {
        autosaveInFlightRef.current = false;
      }
    };

    const id = window.setInterval(() => {
      tick().catch(() => {});
    }, Math.max(10_000, autoSaveIntervalMs));

    return () => window.clearInterval(id);
  }, [
    tauriAvailable,
    effectiveProjectPath,
    orchestrationMode,
    orderedSessions.length,
    autoSaveEnabled,
    autoSaveIntervalMs,
  ]);

  // Also auto-save shortly after session topology changes (crash recovery).
  useEffect(() => {
    if (!tauriAvailable) return;
    if (!effectiveProjectPath) return;
    if (orderedSessions.length === 0) return;
    if (!autoSaveEnabled) return;

    if (autosaveDebounceRef.current !== null) {
      window.clearTimeout(autosaveDebounceRef.current);
    }

    autosaveDebounceRef.current = window.setTimeout(() => {
      autosaveDebounceRef.current = null;
      if (autosaveInFlightRef.current) return;
      autosaveInFlightRef.current = true;
      sessionSnapshotSaveAutosave(effectiveProjectPath, orchestrationMode)
        .catch(() => {})
        .finally(() => {
          autosaveInFlightRef.current = false;
        });
    }, 900);

    return () => {
      if (autosaveDebounceRef.current !== null) {
        window.clearTimeout(autosaveDebounceRef.current);
        autosaveDebounceRef.current = null;
      }
    };
  }, [tauriAvailable, effectiveProjectPath, orchestrationMode, orderedSessions]);

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
      if (isSidebarToggle(e)) {
        if (isEditableTarget(e.target)) return;
        stopEvent(e);
        setSidebarCollapsed((v) => !v);
        return;
      }

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

        if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "s") {
          stopEvent(e);
          if (busy) return;
          const suggested = currentProject?.name ? `${currentProject.name}-layout` : "session-layout";
          const name = window.prompt("Save session layout as:", suggested);
          if (!name) return;

          setError(null);
          setNotice(null);
          setBusy(true);
          sessionSnapshotSaveNamed(effectiveProjectPath, name, orchestrationMode)
            .then((meta) => setNotice(`Saved session: ${meta.id} (${meta.layout})`))
            .catch((err) => setError(String(err)))
            .finally(() => setBusy(false));
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

      if (exitMethod === "ctrl_backslash" && e.ctrlKey && !e.altKey && !e.metaKey && e.key === "\\") {
        stopEvent(e);
        setMode("navigation");
        setActiveSessionId(null);
        return;
      }

      if (
        exitMethod === "ctrl_shift_escape" &&
        e.ctrlKey &&
        e.shiftKey &&
        !e.altKey &&
        !e.metaKey &&
        e.key === "Escape"
      ) {
        stopEvent(e);
        setMode("navigation");
        setActiveSessionId(null);
        return;
      }

      if (exitMethod === "double_escape" && e.key === "Escape") {
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
        }, doubleEscapeTimeoutMs);
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
  }, [
    tauriAvailable,
    orderedSessions,
    mode,
    selectedSessionId,
    activeSessionId,
    busy,
    currentProject?.name,
    effectiveProjectPath,
    orchestrationMode,
    autoSaveEnabled,
    autoSaveIntervalMs,
    exitMethod,
    doubleEscapeTimeoutMs,
  ]);

  const sessionCount = orderedSessions.length;
  const maxSessionsUi = settings?.performance?.maxActiveSessions ?? 12;
  const canAdd = useMemo(() => sessionCount < maxSessionsUi && !busy, [sessionCount, maxSessionsUi, busy]);

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
              const resp = await sessionCreate({ agentType, projectPath, model: modelForAgent(agentType) });
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
        <button
          className="h-9 rounded-lg border border-border bg-bg-primary px-3 text-sm font-medium text-text-secondary hover:bg-bg-hover"
          onClick={() => useAppStore.getState().setSettingsOpen(true)}
          title="Settings (Ctrl+,)"
          type="button"
        >
          Settings
        </button>
        <div className="ml-auto text-xs text-text-secondary">
          {currentProject ? (
            <span className="font-mono">{currentProject.name}</span>
          ) : null}
          {currentProject ? <span className="mx-2 text-border">·</span> : null}
          {sessionCount}/{maxSessionsUi} sessions
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

      <div className="relative flex flex-1 overflow-hidden">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
          width={sidebarWidth}
          maxSessions={maxSessionsUi}
          tauriAvailable={tauriAvailable}
          currentProject={currentProject}
          recentProjects={recentProjects}
          onOpenFolder={async () => {
            setError(null);
            try {
              const picked = await open({
                directory: true,
                multiple: false,
                title: "Open Folder",
              });
              if (!picked) return;
              const path = Array.isArray(picked) ? picked[0] : picked;
              if (!path) return;
              const proj = await persistenceOpenProject(path);
              setCurrentProject(proj);
              await refreshRecentProjects();
            } catch (e) {
              setError(String(e));
            }
          }}
          onSelectProject={async (projectPath: string) => {
            setError(null);
            try {
              const proj = await persistenceOpenProject(projectPath);
              setCurrentProject(proj);
              await refreshRecentProjects();
            } catch (e) {
              setError(String(e));
            }
          }}
          orchestrationMode={orchestrationMode}
          onChangeOrchestrationMode={(m) => {
            // Phase 2.1: UI only. Persisting to .synk/config.json comes later.
            setOrchestrationMode(m);
          }}
          sessions={orderedSessions}
          selectedSessionId={selectedSessionId as SessionId | null}
          onSelectSession={(sessionId) => {
            setSelectedSessionId(sessionId);
            if (mode === "terminal") {
              setActiveSessionId(sessionId);
            }
          }}
        />

        {sidebarCollapsed ? (
          <button
            className="absolute left-2 top-2 z-20 rounded-xl border border-border bg-bg-secondary px-3 py-2 text-xs font-semibold text-text-secondary shadow-[0_14px_40px_rgba(0,0,0,0.35)] hover:bg-bg-hover"
            onClick={() => setSidebarCollapsed(false)}
            title="Expand sidebar (Ctrl+e)"
            type="button"
          >
            Sidebar
          </button>
        ) : null}

        <div className="flex-1 overflow-hidden p-4">
          <SessionGrid
            sessions={orderedSessions}
            mode={mode}
            selectedSessionId={selectedSessionId}
            activeSessionId={activeSessionId}
            dimUnfocused={dimUnfocused}
            dimOpacity={dimOpacity}
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
    </div>
  );
}
