import { useEffect, useMemo, useState } from "react";

import { gitBranches, reviewCreate, reviewGet, reviewList, reviewSetStatus, sessionList } from "../../lib/tauri-api";
import type { ReviewItem, ReviewStatus, SessionInfo } from "../../lib/types";
import { ReviewPanel } from "../review/ReviewPanel";

function pillForStatus(status: ReviewStatus) {
  switch (status) {
    case "pending":
      return { text: "PENDING", cls: "border-border bg-bg-primary/40 text-text-secondary" };
    case "in_review":
      return { text: "IN REVIEW", cls: "border-accent-blue/40 bg-accent-blue/10 text-accent-blue" };
    case "approved":
      return { text: "APPROVED", cls: "border-accent-green/40 bg-accent-green/10 text-accent-green" };
    case "rejected":
      return { text: "REJECTED", cls: "border-accent-red/40 bg-accent-red/10 text-accent-red" };
    case "changes_requested":
      return { text: "CHANGES", cls: "border-accent-orange/40 bg-accent-orange/10 text-accent-orange" };
    case "merging":
      return { text: "MERGING", cls: "border-accent-blue/40 bg-accent-blue/10 text-accent-blue" };
    case "merged":
      return { text: "MERGED", cls: "border-accent-green/40 bg-accent-green/10 text-accent-green" };
    case "merge_conflict":
      return { text: "CONFLICT", cls: "border-accent-red/40 bg-accent-red/10 text-accent-red" };
    default:
      return { text: status, cls: "border-border bg-bg-primary/40 text-text-secondary" };
  }
}

function fmtTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ReviewQueue(props: { tauriAvailable: boolean; projectPath: string | null }) {
  const { tauriAvailable, projectPath } = props;

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lightweight creation form (helps validate the UI until "agent completes task → review ready" wiring lands).
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [createSessionId, setCreateSessionId] = useState<number | null>(null);
  const [createBranch, setCreateBranch] = useState("");
  const [createBaseBranch, setCreateBaseBranch] = useState("main");
  const [creating, setCreating] = useState(false);

  const refresh = async (opts?: { keepSelection?: boolean }) => {
    if (!tauriAvailable) return;
    if (!projectPath) return;
    setLoading(true);
    setError(null);
    try {
      const list = await reviewList(projectPath);
      setItems(list);
      if (!opts?.keepSelection) {
        setSelectedId(list[0]?.id ?? null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setItems([]);
    setSelectedId(null);
    setSelected(null);
    setError(null);
    if (!tauriAvailable) return;
    if (!projectPath) return;
    refresh();
  }, [tauriAvailable, projectPath]);

  useEffect(() => {
    if (!tauriAvailable) return;
    if (!projectPath) return;

    // Pull sessions for the create form.
    sessionList()
      .then((all) => setSessions(all.filter((s) => s.projectPath === projectPath)))
      .catch(() => setSessions([]));

    // Pull local branches for better defaults / validation.
    gitBranches(projectPath)
      .then((b) => setBranches(b))
      .catch(() => setBranches([]));
  }, [tauriAvailable, projectPath]);

  // Pick a sensible default base branch once we have local branches.
  useEffect(() => {
    if (!branches.length) return;
    if (branches.includes(createBaseBranch)) return;
    if (branches.includes("main")) {
      setCreateBaseBranch("main");
    } else if (branches.includes("master")) {
      setCreateBaseBranch("master");
    } else {
      setCreateBaseBranch(branches[0] ?? "main");
    }
  }, [branches.join("|")]);

  // When a session is chosen, prefill branch from that session (best-effort).
  useEffect(() => {
    if (!createSessionId) return;
    const s = sessions.find((x) => x.sessionId === createSessionId);
    if (!s?.branch) return;
    if (createBranch.trim()) return;
    setCreateBranch(s.branch);
  }, [createSessionId, sessions, createBranch]);

  useEffect(() => {
    if (!tauriAvailable) return;
    if (!projectPath) return;
    if (!selectedId) {
      setSelected(null);
      return;
    }

    let alive = true;
    setError(null);
    reviewGet(projectPath, selectedId)
      .then(async (it) => {
        if (!alive) return;
        setSelected(it);
        // Transition pending → in_review on open (best-effort).
        if (it.status === "pending") {
          try {
            const updated = await reviewSetStatus(projectPath, it.id, "in_review");
            if (!alive) return;
            setSelected(updated);
            setItems((prev) => prev.map((p) => (p.id === updated.id ? { ...p, status: updated.status, updatedAt: updated.updatedAt } : p)));
          } catch {
            // ignore
          }
        }
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setSelected(null);
      });

    return () => {
      alive = false;
    };
  }, [tauriAvailable, projectPath, selectedId]);

  const onItemUpdated = (it: ReviewItem) => {
    setSelected(it);
    setItems((prev) => prev.map((p) => (p.id === it.id ? { ...p, status: it.status, updatedAt: it.updatedAt, additions: it.additions, deletions: it.deletions, filesChanged: it.filesChanged } : p)));
  };

  const selectedSummary = useMemo(() => items.find((i) => i.id === selectedId) ?? null, [items, selectedId]);

  if (!tauriAvailable) {
    return (
      <div className="rounded-xl border border-border bg-bg-primary/40 p-4 text-sm text-text-secondary">
        Review queue requires Tauri (`npm run tauri dev`).
      </div>
    );
  }

  if (!projectPath) {
    return (
      <div className="rounded-xl border border-border bg-bg-primary/40 p-4 text-sm text-text-secondary">
        No project open.
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold tracking-tight text-text-secondary">
          Review queue ({items.length})
          {loading ? <span className="ml-2 font-mono text-[11px] text-text-secondary/70">loading…</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded-lg border border-border bg-bg-secondary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
            onClick={() => setCreateOpen((v) => !v)}
            disabled={creating}
            title="Create a review item from a branch (dev helper)"
          >
            {createOpen ? "Hide" : "Create"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-border bg-bg-secondary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
            onClick={() => refresh({ keepSelection: true })}
            disabled={loading}
            title="Refresh review list"
          >
            Refresh
          </button>
        </div>
      </div>

      {createOpen ? (
        <div className="rounded-xl border border-border bg-bg-primary/30 p-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <label className="flex flex-col gap-1">
              <div className="text-[11px] font-semibold text-text-secondary">Session</div>
              <select
                className="h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 font-mono text-[12px] text-text-primary"
                value={createSessionId ?? ""}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setCreateSessionId(Number.isFinite(v) ? v : null);
                }}
              >
                <option value="" disabled>
                  pick…
                </option>
                {sessions.map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    {s.sessionId} {s.branch ? `(${s.branch})` : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 md:col-span-1">
              <div className="text-[11px] font-semibold text-text-secondary">Branch</div>
              <input
                className="h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 font-mono text-[12px] text-text-primary"
                value={createBranch}
                onChange={(e) => setCreateBranch(e.target.value)}
                placeholder="feat/my-change"
                list="synk-branch-list"
              />
              <datalist id="synk-branch-list">
                {branches.slice(0, 200).map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>

            <label className="flex flex-col gap-1 md:col-span-1">
              <div className="text-[11px] font-semibold text-text-secondary">Base</div>
              {branches.length ? (
                <select
                  className="h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 font-mono text-[12px] text-text-primary"
                  value={createBaseBranch}
                  onChange={(e) => setCreateBaseBranch(e.target.value)}
                >
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className="h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 font-mono text-[12px] text-text-primary"
                  value={createBaseBranch}
                  onChange={(e) => setCreateBaseBranch(e.target.value)}
                  placeholder="main"
                />
              )}
            </label>

            <div className="flex items-end">
              <button
                type="button"
                className="h-9 w-full rounded-lg border border-accent-blue/45 bg-accent-blue/10 px-3 text-[11px] font-semibold text-accent-blue hover:bg-accent-blue/15 disabled:opacity-60"
                disabled={creating || !createSessionId || !createBranch.trim() || !createBaseBranch.trim()}
                onClick={async () => {
                  if (!createSessionId) return;
                  setCreating(true);
                  setError(null);
                  try {
                    const it = await reviewCreate(projectPath, createSessionId, createBranch.trim(), createBaseBranch.trim());
                    setItems((prev) => [it, ...prev]);
                    setSelectedId(it.id);
                    setCreateOpen(false);
                    setCreateBranch("");
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setCreating(false);
                  }
                }}
              >
                Create review
              </button>
            </div>
          </div>

          <div className="mt-2 text-[11px] text-text-secondary/70">
            This is a stopgap until the “agent completes task → Review Ready” wiring is implemented.
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-accent-red/40 bg-accent-red/10 p-3 text-sm text-accent-red">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="w-[320px] min-w-[260px] max-w-[380px] overflow-auto rounded-xl border border-border bg-bg-primary/30">
          {items.length === 0 ? (
            <div className="p-4 text-sm text-text-secondary">
              No reviews yet.
              <div className="mt-1 text-xs text-text-secondary/70">
                When a session finishes work, a ReviewItem should be created and show up here.
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((it) => {
                const selected = it.id === selectedId;
                const pill = pillForStatus(it.status);
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      className={[
                        "w-full px-3 py-3 text-left transition",
                        selected ? "bg-bg-hover" : "hover:bg-bg-hover/70",
                      ].join(" ")}
                      onClick={() => setSelectedId(it.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-text-primary">{it.branch}</div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-text-secondary">
                            → {it.baseBranch} · {fmtTime(it.updatedAt)}
                          </div>
                        </div>
                        <span className={["shrink-0 rounded-full border px-2 py-1 font-mono text-[10px]", pill.cls].join(" ")}>
                          {pill.text}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-[11px] text-text-secondary">
                        <span className="rounded-md border border-border bg-bg-secondary px-2 py-0.5 font-mono">
                          {it.filesChanged} file{it.filesChanged === 1 ? "" : "s"}
                        </span>
                        <span className="text-accent-green">+{it.additions}</span>
                        <span className="text-accent-red">−{it.deletions}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-bg-primary/30">
          {selected && selectedSummary ? (
            <div className="h-full">
              <ReviewPanel
                tauriAvailable={tauriAvailable}
                projectPath={projectPath}
                review={selected}
                onReviewUpdated={onItemUpdated}
              />
            </div>
          ) : (
            <div className="p-4 text-sm text-text-secondary">Select a review to inspect diffs and comment.</div>
          )}
        </div>
      </div>
    </div>
  );
}
