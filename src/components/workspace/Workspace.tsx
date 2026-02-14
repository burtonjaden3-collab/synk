import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  CodexProvider,
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
import { BottomDrawer } from "../drawer/BottomDrawer";
import { defaultAppSettings } from "../../lib/default-settings";

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
  const [agentType, setAgentType] = useState<AgentType>("terminal");
  const [detectedAgents, setDetectedAgents] = useState<Record<AgentType, DetectedAgent> | null>(null);
  const [mode, setMode] = useState<InputMode>("navigation");
  const [selectedSessionId, setSelectedSessionId] = useState<number | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const tauriAvailable = useMemo(() => isTauri(), []);
  const orchestrationMode: OrchestrationMode = "manual";

  const outputHandlersRef = useRef<Map<number, OutputHandler>>(new Map());
  const escapeTimerRef = useRef<number | null>(null);
  const autosaveInFlightRef = useRef(false);
  const autosaveDebounceRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const restoreRunIdRef = useRef(0);
  const keyHandlerStateRef = useRef<{
    orderedSessions: SessionInfo[];
    mode: InputMode;
    selectedSessionId: number | null;
    activeSessionId: number | null;
    busy: boolean;
    currentProjectName: string | null;
    effectiveProjectPath: string;
    exitMethod: "double_escape" | "ctrl_backslash" | "ctrl_shift_escape";
    doubleEscapeTimeoutMs: number;
  }>({
    orderedSessions: [],
    mode: "navigation",
    selectedSessionId: null,
    activeSessionId: null,
    busy: false,
    currentProjectName: null,
    effectiveProjectPath: ".",
    exitMethod: "double_escape",
    doubleEscapeTimeoutMs: 300,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshSessions = useCallback(async () => {
    const list = await sessionList();
    setSessions(list);
  }, []);

  const refreshRecentProjects = useCallback(async () => {
    const list = await persistenceListRecentProjects();
    setRecentProjects(list);
  }, []);

  const sessionCreateCompat = useCallback(
    async (args: {
      agentType: AgentType;
      projectPath: string;
      branch?: string;
      workingDir?: string;
      model?: string;
      codexProvider?: CodexProvider;
    }) => {
      try {
        return await sessionCreate(args);
      } catch (e) {
        const msg = String(e ?? "");
        const shouldFallback =
          args.agentType === "openrouter" &&
          (msg.includes("unknown variant `openrouter`") || msg.includes("expected one of"));
        if (!shouldFallback) throw e;
        // Compatibility for older backends: use codex runtime + OpenRouter provider override.
        return sessionCreate({
          ...args,
          agentType: "codex",
          codexProvider: "openrouter",
        });
      }
    },
    [],
  );

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
    if (!tauriAvailable) return;
    if (!currentProject?.path) {
      setProjectConfig(null);
      return;
    }
    projectConfigGet(currentProject.path)
      .then((cfg) => setProjectConfig(cfg))
      .catch(() => setProjectConfig(null));
  }, [tauriAvailable, currentProject?.path, setProjectConfig]);

  const orderedSessions = useMemo(
    () => [...sessions].sort((a, b) => a.paneIndex - b.paneIndex),
    [sessions],
  );

  const effectiveProjectPath = useMemo(() => currentProject?.path ?? ".", [currentProject?.path]);

  const autoSaveEnabled = settings?.session?.autoSave ?? true;
  const autoSaveIntervalMs = (settings?.session?.autoSaveIntervalSeconds ?? 60) * 1000;
  const exitMethod = settings?.keyboard?.terminalExitMethod ?? "double_escape";
  const doubleEscapeTimeoutMs = settings?.keyboard?.doubleEscapeTimeoutMs ?? 300;
  const dimUnfocused = settings?.ui?.dimUnfocusedPanes ?? true;
  const dimOpacity = settings?.ui?.unfocusedOpacity ?? 0.7;
  const sidebarWidth = settings?.ui?.sidebarWidth ?? 280;
  const models = useMemo(() => {
    const defaults = defaultAppSettings().aiProviders;
    const raw = (settings?.aiProviders ?? {}) as Partial<typeof defaults>;
    return {
      ...defaults,
      ...raw,
      anthropic: { ...defaults.anthropic, ...(raw.anthropic ?? {}) },
      google: { ...defaults.google, ...(raw.google ?? {}) },
      openai: { ...defaults.openai, ...(raw.openai ?? {}) },
      openrouter: { ...defaults.openrouter, ...(raw.openrouter ?? {}) },
      ollama: { ...defaults.ollama, ...(raw.ollama ?? {}) },
    };
  }, [settings?.aiProviders]);

  const modelForAgent = useMemo(() => {
    return (t: AgentType): string | undefined => {
      switch (t) {
        case "claude_code":
          return models.anthropic.defaultModel || undefined;
        case "gemini_cli":
          return models.google.defaultModel || undefined;
        case "codex":
          return models.openai.defaultModel || undefined;
        case "openrouter":
          return models.openrouter.defaultModel || undefined;
        case "terminal":
        default:
          return undefined;
      }
    };
  }, [models]);

  const agentVersions = useMemo(() => {
    const out: Partial<Record<AgentType, string | null>> = {};
    if (!detectedAgents) return out;
    const codexVersion = detectedAgents.codex?.version ?? null;
    for (const [k, v] of Object.entries(detectedAgents) as Array<[AgentType, DetectedAgent]>) {
      out[k] = v.version ?? null;
    }
    if (!out.openrouter) {
      out.openrouter = codexVersion;
    }
    return out;
  }, [detectedAgents]);

  const codexProviderForSelection = useMemo(
    () =>
      (t: AgentType): CodexProvider | undefined => {
        if (t === "codex") return "openai";
        return undefined;
      },
    [],
  );

  useEffect(() => {
    keyHandlerStateRef.current = {
      orderedSessions,
      mode,
      selectedSessionId,
      activeSessionId,
      busy,
      currentProjectName: currentProject?.name ?? null,
      effectiveProjectPath,
      exitMethod,
      doubleEscapeTimeoutMs,
    };
  }, [
    orderedSessions,
    mode,
    selectedSessionId,
    activeSessionId,
    busy,
    currentProject?.name,
    effectiveProjectPath,
    exitMethod,
    doubleEscapeTimeoutMs,
  ]);

  // If HomeScreen asked for a restore, do it immediately on entry.
  useEffect(() => {
    if (!tauriAvailable) return;
    if (!pendingSessionRestoreId) return;
    if (!effectiveProjectPath) return;

    const runId = restoreRunIdRef.current + 1;
    restoreRunIdRef.current = runId;
    const isCurrent = () => mountedRef.current && restoreRunIdRef.current === runId;

    (async () => {
      setError(null);
      setNotice(`Restoring session "${pendingSessionRestoreId}"...`);
      setBusy(true);

      const snap = await sessionSnapshotLoad(pendingSessionRestoreId);
      if (!isCurrent()) return;
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
        const resp = await sessionCreateCompat({
          agentType: p.agentType,
          projectPath: snap.projectPath,
          branch: p.branch ?? undefined,
          workingDir: p.workingDir,
          model: modelForAgent(p.agentType),
          codexProvider:
            p.agentType === "codex" ? "openai" : p.agentType === "openrouter" ? "openrouter" : undefined,
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
      if (!isCurrent()) return;

      setNotice(`Session restored: ${panes.length} panes`);
      setPendingSessionRestoreId(null);
    })()
      .catch((e) => {
        if (!isCurrent()) return;
        setError(String(e));
        setNotice(null);
        setPendingSessionRestoreId(null);
      })
      .finally(() => {
        if (!isCurrent()) return;
        setBusy(false);
      });

    return () => {
      // No-op: dependency changes can be triggered by this effect itself
      // (e.g. `setPendingSessionRestoreId(null)`). We use a runId gate instead.
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
    let disposed = false;

    onSessionOutput((payload: SessionOutputEvent) => {
      const h = outputHandlersRef.current.get(payload.sessionId);
      if (!h) return;
      h(payload.dataB64);
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlistenOutput = fn;
      }
    });

    onSessionExit((payload: SessionExitEvent) => {
      // Keep it simple for Phase 1: refresh the list when a session exits.
      refreshSessions().catch(() => {});
      // Also allow panes to show a local marker if they want.
      const h = outputHandlersRef.current.get(payload.sessionId);
      if (h) h(btoa(`\r\n[session exited: ${payload.exitCode}]\r\n`));
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlistenExit = fn;
      }
    });

    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
    };
  }, [tauriAvailable]);

  useEffect(() => {
    if (!tauriAvailable) return;

    const handler = (e: KeyboardEvent) => {
      const state = keyHandlerStateRef.current;
      const ordered = state.orderedSessions;

      if (isSidebarToggle(e)) {
        if (isEditableTarget(e.target)) return;
        stopEvent(e);
        setSidebarCollapsed((v) => !v);
        return;
      }

      if (ordered.length === 0) return;

      // Always intercept Ctrl+b (reserved for future broadcast).
      if (e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "b") {
        stopEvent(e);
        return;
      }

      if (state.mode === "navigation") {
        if (isEditableTarget(e.target)) return;

        const idxFromNumber = keyToSessionIndex(e.key);
        if (idxFromNumber !== null) {
          const next = idxFromNumber < ordered.length ? ordered[idxFromNumber] : null;
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
          const { cols } = gridForCount(ordered.length);
          const currentIndex = Math.max(
            0,
            ordered.findIndex((s) => s.sessionId === state.selectedSessionId),
          );
          const nextIndex = moveIndex(currentIndex, dir, cols, ordered.length);
          setSelectedSessionId(ordered[nextIndex].sessionId);
          return;
        }

        if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "s") {
          stopEvent(e);
          if (state.busy) return;
          const suggested = state.currentProjectName ? `${state.currentProjectName}-layout` : "session-layout";
          const name = window.prompt("Save session layout as:", suggested);
          if (!name) return;

          setError(null);
          setNotice(null);
          setBusy(true);
          sessionSnapshotSaveNamed(state.effectiveProjectPath, name, orchestrationMode)
            .then((meta) => setNotice(`Saved session: ${meta.id} (${meta.layout})`))
            .catch((err) => setError(String(err)))
            .finally(() => setBusy(false));
          return;
        }

        if (e.key === "Enter") {
          stopEvent(e);
          const sid = state.selectedSessionId ?? ordered[0].sessionId;
          setSelectedSessionId(sid);
          setActiveSessionId(sid);
          setMode("terminal");
          return;
        }

        return;
      }

      // Terminal mode.
      const sid = state.activeSessionId ?? state.selectedSessionId;
      if (!sid) return;

      if (state.exitMethod === "ctrl_backslash" && e.ctrlKey && !e.altKey && !e.metaKey && e.key === "\\") {
        stopEvent(e);
        setMode("navigation");
        setActiveSessionId(null);
        return;
      }

      if (
        state.exitMethod === "ctrl_shift_escape" &&
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

      if (state.exitMethod === "double_escape" && e.key === "Escape") {
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
        }, state.doubleEscapeTimeoutMs);
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
  }, [tauriAvailable, refreshSessions, orchestrationMode]);

  const sessionCount = orderedSessions.length;
  const maxSessionsUi = settings?.performance?.maxActiveSessions ?? 12;
  const canAdd = useMemo(() => sessionCount < maxSessionsUi && !busy, [sessionCount, maxSessionsUi, busy]);
  const addDisabledReason = useMemo(() => {
    if (!tauriAvailable) return "Requires Tauri (run `npm run tauri dev`).";
    if (busy) return "Busy (restoring/saving). Wait for it to finish.";
    if (sessionCount >= maxSessionsUi)
      return `Max sessions reached (${maxSessionsUi}). Close a pane or increase Settings -> Performance -> Max active sessions.`;
    return "";
  }, [tauriAvailable, busy, sessionCount, maxSessionsUi]);

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
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <div className="text-xs font-medium text-text-secondary">Project</div>
          <div
            className="max-w-[340px] truncate rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm font-semibold text-text-primary"
            title={currentProject?.path ?? ""}
          >
            {currentProject?.name ?? "(unknown)"}
          </div>
        </div>
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
              <option value="openrouter">
                openrouter
                {detectedAgents &&
                !(detectedAgents.openrouter?.found ?? detectedAgents.codex?.found ?? false)
                  ? " (needs codex CLI)"
                  : ""}
              </option>
            </select>
          </label>
        <button
          className="ml-2 h-9 rounded-lg border border-border bg-bg-primary px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!tauriAvailable || !canAdd}
          title={addDisabledReason || "Add a new session pane"}
          onClick={async () => {
            setError(null);
            setNotice(null);
            setBusy(true);
            try {
              const resp = await sessionCreateCompat({
                agentType,
                projectPath: effectiveProjectPath,
                model: modelForAgent(agentType),
                codexProvider: codexProviderForSelection(agentType),
              });
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
          sessions={orderedSessions}
          selectedSessionId={selectedSessionId as SessionId | null}
          onSelectSession={(sessionId) => {
            setSelectedSessionId(sessionId);
            if (mode === "terminal") {
              setActiveSessionId(sessionId);
            }
          }}
          onRefreshSessions={() => {
            refreshSessions().catch(() => {});
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
          <div className="flex h-full w-full flex-col gap-3 overflow-hidden">
            <div className="flex-1 overflow-hidden">
              <SessionGrid
                sessions={orderedSessions}
                agentVersions={agentVersions}
                fallbackModelForAgent={modelForAgent}
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

            <BottomDrawer tauriAvailable={tauriAvailable} mode={mode} />
          </div>
        </div>
      </div>
    </div>
  );
}
