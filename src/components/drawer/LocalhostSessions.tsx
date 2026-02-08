import { useEffect, useMemo, useRef, useState } from "react";

import {
  gitListWorktrees,
  localhostSessionDelete,
  localhostSessionList,
  localhostSessionLogs,
  localhostSessionRestart,
  localhostSessionStart,
  localhostSessionStop,
  localhostSessionUpsert,
  onLocalhostSessionLog,
  onLocalhostSessionStatus,
} from "../../lib/tauri-api";
import type {
  LocalhostPortMode,
  LocalhostSessionSpec,
  LocalhostSessionType,
  LocalhostSessionView,
  WorktreeInfo,
} from "../../lib/types";

type SourceOption = {
  key: string;
  label: string;
  workingDir: string;
};

function projectNameFromPath(p: string) {
  const cleaned = p.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]/);
  return parts[parts.length - 1] || cleaned || "project";
}

function displayBranch(branch: string | null | undefined) {
  if (!branch) return null;
  const b = branch.trim();
  if (!b) return null;
  return b.replace(/^refs\/heads\//, "");
}

function labelForWorktree(w: WorktreeInfo) {
  const b = displayBranch(w.branch ?? null);
  if (b) return b;
  if (w.detached) return "detached";
  if (w.head) return w.head.slice(0, 7);
  return "worktree";
}

function badgeClass(status: LocalhostSessionView["status"]) {
  switch (status) {
    case "running":
      return "bg-accent-green/15 text-accent-green border-accent-green/30";
    case "starting":
      return "bg-accent-orange/15 text-accent-orange border-accent-orange/30";
    case "exited":
      return "bg-accent-red/15 text-accent-red border-accent-red/30";
    case "stopped":
    default:
      return "bg-bg-primary/60 text-text-secondary border-border";
  }
}

export function LocalhostSessions(props: { tauriAvailable: boolean; projectPath: string | null }) {
  const { tauriAvailable, projectPath } = props;

  const [sessions, setSessions] = useState<LocalhostSessionView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [logsById, setLogsById] = useState<Record<string, string[]>>({});
  const logsEndRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => (selectedId ? sessions.find((s) => s.id === selectedId) ?? null : null),
    [sessions, selectedId],
  );

  const refresh = async () => {
    if (!tauriAvailable || !projectPath) return;
    const list = await localhostSessionList(projectPath);
    setSessions(list);
    if (selectedId && !list.some((s) => s.id === selectedId)) setSelectedId(null);
  };

  useEffect(() => {
    setSessions([]);
    setSelectedId(null);
    setError(null);
    setLogsById({});
    refresh().catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauriAvailable, projectPath]);

  useEffect(() => {
    if (!tauriAvailable || !projectPath) return;

    let unlistenLog: null | (() => void) = null;
    let unlistenStatus: null | (() => void) = null;

    onLocalhostSessionLog((ev) => {
      if (ev.projectPath !== projectPath) return;
      setLogsById((prev) => {
        const next = { ...prev };
        const arr = next[ev.id] ? [...next[ev.id]] : [];
        arr.push(`${ev.stream === "stderr" ? "!" : " "} ${ev.line}`);
        next[ev.id] = arr.length > 600 ? arr.slice(arr.length - 600) : arr;
        return next;
      });
    }).then((fn) => {
      unlistenLog = fn;
    });

    onLocalhostSessionStatus((ev) => {
      if (ev.projectPath !== projectPath) return;
      setSessions((prev) =>
        prev.map((s) =>
          s.id === ev.id
            ? {
                ...s,
                status: ev.status,
                port: ev.port,
                pid: ev.pid,
                url: ev.url,
                lastExitCode: ev.lastExitCode ?? s.lastExitCode,
              }
            : s,
        ),
      );
    }).then((fn) => {
      unlistenStatus = fn;
    });

    return () => {
      unlistenLog?.();
      unlistenStatus?.();
    };
  }, [tauriAvailable, projectPath]);

  useEffect(() => {
    const el = logsEndRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "auto", block: "end" });
  }, [selectedId, logsById[selectedId ?? ""]?.length]);

  useEffect(() => {
    if (!tauriAvailable || !projectPath || !selectedId) return;
    localhostSessionLogs(projectPath, selectedId)
      .then((lines) => {
        setLogsById((prev) => ({ ...prev, [selectedId]: lines.length ? lines : prev[selectedId] ?? [] }));
      })
      .catch(() => {});
  }, [tauriAvailable, projectPath, selectedId]);

  const [addOpen, setAddOpen] = useState(false);
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [sourceKey, setSourceKey] = useState<string>("main");
  const [type, setType] = useState<LocalhostSessionType>("web");
  const [portMode, setPortMode] = useState<LocalhostPortMode>("auto");
  const [preferredPort, setPreferredPort] = useState<string>("");
  const [autoInstall, setAutoInstall] = useState(true);

  const openAdd = async () => {
    if (!tauriAvailable || !projectPath) return;
    setError(null);
    setAddOpen(true);
    try {
      const worktrees = await gitListWorktrees(projectPath);
      const opts: SourceOption[] = [
        { key: "main", label: "main", workingDir: projectPath },
        ...worktrees
          .filter((w) => !!w.path && w.path !== projectPath)
          .map((w) => ({
            key: w.path,
            label: labelForWorktree(w),
            workingDir: w.path,
          })),
      ];
      // De-dupe by workingDir.
      const seen = new Set<string>();
      const deduped = opts.filter((o) => {
        if (seen.has(o.workingDir)) return false;
        seen.add(o.workingDir);
        return true;
      });
      setSources(deduped);
      setSourceKey(deduped[0]?.key ?? "main");
    } catch (e) {
      setError(String(e));
      setSources([{ key: "main", label: "main", workingDir: projectPath }]);
      setSourceKey("main");
    }

    setType("web");
    setPortMode("auto");
    setPreferredPort("");
    setAutoInstall(true);
  };

  const addDisabled = !tauriAvailable || !projectPath;

  const selectedSource = useMemo(() => sources.find((s) => s.key === sourceKey) ?? null, [sources, sourceKey]);

  const createSession = async () => {
    if (!tauriAvailable || !projectPath) return;
    if (!selectedSource) return;
    setError(null);
    setBusyId("create");

    const port =
      portMode === "manual" ? (preferredPort.trim() ? Number(preferredPort.trim()) : NaN) : null;
    if (portMode === "manual" && (!Number.isFinite(port) || port! <= 0)) {
      setBusyId(null);
      setError("Manual port requires a valid number");
      return;
    }

    try {
      const spec: Omit<LocalhostSessionSpec, "id" | "createdAt"> & { id?: string | null } = {
        projectPath,
        workingDir: selectedSource.workingDir,
        sourceLabel: selectedSource.label,
        type,
        portMode,
        preferredPort: portMode === "manual" ? (port as number) : null,
        autoInstallDeps: autoInstall,
      };
      const next = await localhostSessionUpsert(spec);
      setSessions(next);
      setAddOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const start = async (id: string) => {
    if (!tauriAvailable || !projectPath) return;
    setError(null);
    setBusyId(id);
    try {
      const view = await localhostSessionStart(projectPath, id);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...view } : s)));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const stop = async (id: string) => {
    if (!tauriAvailable || !projectPath) return;
    setError(null);
    setBusyId(id);
    try {
      const view = await localhostSessionStop(projectPath, id);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...view } : s)));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const restart = async (id: string) => {
    if (!tauriAvailable || !projectPath) return;
    setError(null);
    setBusyId(id);
    try {
      const view = await localhostSessionRestart(projectPath, id);
      setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, ...view } : s)));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    if (!tauriAvailable || !projectPath) return;
    setError(null);
    setBusyId(id);
    try {
      const next = await localhostSessionDelete(projectPath, id);
      setSessions(next);
      setLogsById((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
      if (selectedId === id) setSelectedId(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const openUrl = (url: string | null | undefined) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (!tauriAvailable) {
    return (
      <div className="rounded-xl border border-border bg-bg-primary/40 p-4 text-sm text-text-secondary">
        Localhost sessions require Tauri. Run <span className="font-mono">npm run tauri dev</span>.
      </div>
    );
  }

  if (!projectPath) {
    return (
      <div className="rounded-xl border border-border bg-bg-primary/40 p-4 text-sm text-text-secondary">
        Open a project to manage Localhost sessions.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary">Localhost Sessions</div>
          <div className="truncate font-mono text-[11px] text-text-secondary">
            {projectNameFromPath(projectPath)}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
            disabled={addDisabled}
            onClick={() => refresh().catch(() => {})}
          >
            Refresh
          </button>
          <button
            type="button"
            className="rounded-lg border border-accent-blue/30 bg-accent-blue/15 px-3 py-2 text-xs font-semibold text-accent-blue hover:bg-accent-blue/20 disabled:opacity-50"
            disabled={addDisabled}
            onClick={() => openAdd().catch(() => {})}
          >
            + Add
          </button>
        </div>
      </div>

      {error ? <div className="text-sm text-accent-red">{error}</div> : null}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          {sessions.length === 0 ? (
            <div className="rounded-xl border border-border bg-bg-primary/40 p-4 text-sm text-text-secondary">
              No localhost sessions yet.
            </div>
          ) : null}

          {sessions.map((s) => {
            const isSelected = selectedId === s.id;
            const isBusy = busyId === s.id;
            return (
              <div
                key={s.id}
                className={[
                  "rounded-xl border p-3 transition",
                  isSelected ? "border-accent-blue/40 bg-bg-primary/60" : "border-border bg-bg-primary/40 hover:bg-bg-primary/55",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => setSelectedId((v) => (v === s.id ? null : s.id))}
                    title={s.workingDir}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-text-primary">{s.sourceLabel}</span>
                      <span className="rounded-md border border-border bg-bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                        {s.type}
                      </span>
                      <span className={["rounded-md border px-2 py-0.5 text-[10px] font-semibold", badgeClass(s.status)].join(" ")}>
                        {s.status}
                      </span>
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-text-secondary">
                      {s.url ? s.url : s.port ? `localhost:${s.port}` : "not running"}
                    </div>
                  </button>

                  <div className="flex shrink-0 items-center gap-2">
                    {s.status === "running" || s.status === "starting" ? (
                      <button
                        type="button"
                        className="rounded-lg border border-border bg-bg-secondary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                        disabled={isBusy}
                        onClick={() => stop(s.id).catch(() => {})}
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg border border-accent-green/30 bg-accent-green/15 px-2 py-1 text-[11px] font-semibold text-accent-green hover:bg-accent-green/20 disabled:opacity-50"
                        disabled={isBusy}
                        onClick={() => start(s.id).catch(() => {})}
                      >
                        Start
                      </button>
                    )}
                    <button
                      type="button"
                      className="rounded-lg border border-border bg-bg-secondary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                      disabled={isBusy}
                      onClick={() => restart(s.id).catch(() => {})}
                      title="Restart"
                    >
                      ↻
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-border bg-bg-secondary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-50"
                      disabled={!s.url}
                      onClick={() => openUrl(s.url)}
                      title="Open in browser"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-accent-red/30 bg-accent-red/10 px-2 py-1 text-[11px] font-semibold text-accent-red hover:bg-accent-red/15 disabled:opacity-50"
                      disabled={isBusy}
                      onClick={() => remove(s.id).catch(() => {})}
                      title="Delete session"
                    >
                      ×
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-3">
          {selected ? (
            <>
              <div className="rounded-xl border border-border bg-bg-primary/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-text-primary">
                      {selected.sourceLabel}{" "}
                      <span className="font-mono text-[11px] text-text-secondary">({selected.type})</span>
                    </div>
                    <div className="truncate font-mono text-[11px] text-text-secondary">{selected.workingDir}</div>
                    {selected.url ? (
                      <button
                        type="button"
                        className="mt-1 font-mono text-[11px] text-accent-blue hover:underline"
                        onClick={() => openUrl(selected.url)}
                        title="Open in browser"
                      >
                        {selected.url}
                      </button>
                    ) : (
                      <div className="mt-1 font-mono text-[11px] text-text-secondary">No URL (stopped)</div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={["rounded-md border px-2 py-1 text-[10px] font-semibold", badgeClass(selected.status)].join(" ")}>
                      {selected.status}
                    </span>
                  </div>
                </div>
              </div>

              {selected.type === "web" && selected.status === "running" && selected.url ? (
                <div className="overflow-hidden rounded-xl border border-border bg-bg-primary/30">
                  <div className="flex items-center justify-between border-b border-border bg-bg-secondary px-3 py-2">
                    <div className="text-[11px] font-semibold tracking-wide text-text-secondary">PREVIEW</div>
                    <button
                      type="button"
                      className="rounded-lg border border-border bg-bg-primary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                      onClick={() => openUrl(selected.url)}
                    >
                      Open External
                    </button>
                  </div>
                  <iframe
                    title={`localhost-preview-${selected.id}`}
                    className="h-[260px] w-full bg-bg-primary"
                    src={selected.url}
                    referrerPolicy="no-referrer"
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-border bg-bg-primary/30 p-3 text-sm text-text-secondary">
                  {selected.type === "desktop"
                    ? "Desktop sessions launch a separate Tauri window. Use logs below to debug."
                    : selected.status === "running"
                      ? "Preview unavailable (missing URL)."
                      : "Start the session to preview it."}
                </div>
              )}

              <div className="overflow-hidden rounded-xl border border-border bg-bg-primary/30">
                <div className="flex items-center justify-between border-b border-border bg-bg-secondary px-3 py-2">
                  <div className="text-[11px] font-semibold tracking-wide text-text-secondary">LOGS</div>
                  <button
                    type="button"
                    className="rounded-lg border border-border bg-bg-primary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    onClick={() => {
                      setLogsById((prev) => ({ ...prev, [selected.id]: [] }));
                    }}
                  >
                    Clear
                  </button>
                </div>
                <div className="max-h-[260px] overflow-auto p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
                  {(logsById[selected.id] ?? []).length === 0 ? (
                    <div className="text-text-secondary/70">No logs yet.</div>
                  ) : (
                    (logsById[selected.id] ?? []).map((l, idx) => (
                      <div key={idx} className="whitespace-pre-wrap break-words">
                        {l}
                      </div>
                    ))
                  )}
                  <div ref={logsEndRef} />
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-border bg-bg-primary/40 p-4 text-sm text-text-secondary">
              Select a session to see its preview and logs.
            </div>
          )}
        </div>
      </div>

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-secondary shadow-[0_20px_80px_rgba(0,0,0,0.55)]">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="text-sm font-semibold text-text-primary">Add Localhost Session</div>
              <button
                type="button"
                className="rounded-lg border border-border bg-bg-primary px-2 py-1 text-xs font-semibold text-text-secondary hover:bg-bg-hover"
                onClick={() => setAddOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="space-y-4 p-4">
              <label className="block text-xs font-semibold text-text-secondary">
                Source
                <select
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-bg-primary px-3 text-sm text-text-primary"
                  value={sourceKey}
                  onChange={(e) => setSourceKey(e.target.value)}
                >
                  {sources.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label} {s.key === "main" ? "(project root)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-text-secondary">
                  Type
                  <select
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-bg-primary px-3 text-sm text-text-primary"
                    value={type}
                    onChange={(e) => setType(e.target.value as LocalhostSessionType)}
                  >
                    <option value="web">Web (Vite)</option>
                    <option value="desktop">Desktop (Tauri)</option>
                  </select>
                </label>

                <label className="block text-xs font-semibold text-text-secondary">
                  Port
                  <select
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-bg-primary px-3 text-sm text-text-primary"
                    value={portMode}
                    onChange={(e) => setPortMode(e.target.value as LocalhostPortMode)}
                  >
                    <option value="auto">Auto</option>
                    <option value="manual">Manual</option>
                  </select>
                </label>
              </div>

              {portMode === "manual" ? (
                <label className="block text-xs font-semibold text-text-secondary">
                  Preferred port
                  <input
                    className="mt-1 h-10 w-full rounded-lg border border-border bg-bg-primary px-3 text-sm text-text-primary"
                    value={preferredPort}
                    onChange={(e) => setPreferredPort(e.target.value)}
                    placeholder="1430"
                    inputMode="numeric"
                  />
                </label>
              ) : null}

              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent-blue"
                  checked={autoInstall}
                  onChange={(e) => setAutoInstall(e.target.checked)}
                />
                Auto install deps (npm install) if needed
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
              <button
                type="button"
                className="rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-hover"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-lg border border-accent-green/30 bg-accent-green/15 px-3 py-2 text-xs font-semibold text-accent-green hover:bg-accent-green/20 disabled:opacity-50"
                disabled={busyId === "create" || !selectedSource}
                onClick={() => createSession().catch(() => {})}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
