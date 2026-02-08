import { useEffect, useMemo, useRef, useState } from "react";

import { onGitEvent } from "../../lib/tauri-api";
import type { GitEvent, GitEventType } from "../../lib/types";

function iconFor(t: GitEventType) {
  switch (t) {
    case "commit":
      return "●";
    case "branch_created":
      return "+";
    case "branch_deleted":
      return "−";
    case "merge_completed":
      return "⇄";
    case "conflict_detected":
      return "!";
    default:
      return "·";
  }
}

function labelFor(t: GitEventType) {
  switch (t) {
    case "commit":
      return "Commit";
    case "branch_created":
      return "Branch created";
    case "branch_deleted":
      return "Branch deleted";
    case "merge_completed":
      return "Merge";
    case "conflict_detected":
      return "Conflict";
    default:
      return "Event";
  }
}

function timeOf(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function describe(e: GitEvent) {
  switch (e.eventType) {
    case "commit": {
      const h = e.hash ? e.hash.slice(0, 7) : "???????";
      const branch = e.branch ? ` on ${e.branch}` : "";
      const author = e.author ? ` by ${e.author}` : "";
      const msg = e.message ? `: ${e.message}` : "";
      return `${h}${branch}${author}${msg}`;
    }
    case "branch_created":
      return e.branch ? e.branch : "branch";
    case "branch_deleted":
      return e.branch ? e.branch : "branch";
    case "merge_completed": {
      const b = e.branch ?? "branch";
      const base = e.baseBranch ?? "base";
      const strat = e.strategy ? ` (${e.strategy})` : "";
      return `${b} → ${base}${strat}`;
    }
    case "conflict_detected": {
      const b = e.branch ?? "branch";
      const base = e.baseBranch ?? "base";
      const n = e.conflictFiles?.length ?? 0;
      return `${b} into ${base} (${n} file${n === 1 ? "" : "s"})`;
    }
    default:
      return e.id;
  }
}

export function GitActivityFeed(props: { tauriAvailable: boolean; projectPath: string | null }) {
  const { tauriAvailable, projectPath } = props;
  const [events, setEvents] = useState<GitEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [unseen, setUnseen] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!tauriAvailable) return;
    if (!projectPath) return;

    let unlisten: (() => void) | null = null;
    onGitEvent((ev) => {
      if (ev.projectPath !== projectPath) return;

      setEvents((prev) => {
        // Basic de-dupe by id.
        if (prev.some((p) => p.id === ev.id)) return prev;
        const next = [...prev, ev];
        // Keep bounded to avoid unbounded memory growth.
        return next.length > 400 ? next.slice(next.length - 400) : next;
      });

      setUnseen((n) => (stickToBottom ? 0 : n + 1));
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [tauriAvailable, projectPath, stickToBottom]);

  useEffect(() => {
    if (!stickToBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events, stickToBottom]);

  const selected = useMemo(
    () => (selectedId ? events.find((e) => e.id === selectedId) ?? null : null),
    [events, selectedId],
  );

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 16;
    setStickToBottom(atBottom);
    if (atBottom) setUnseen(0);
  };

  if (!tauriAvailable) {
    return (
      <div className="rounded-xl border border-border bg-bg-primary/40 p-4 text-sm text-text-secondary">
        Git feed requires Tauri (`npm run tauri dev`).
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
          Live events ({events.length})
        </div>
        {!stickToBottom && unseen > 0 ? (
          <button
            type="button"
            className="rounded-lg border border-accent-blue/40 bg-accent-blue/10 px-2 py-1 text-[11px] font-semibold text-accent-blue hover:bg-accent-blue/15"
            onClick={() => {
              const el = scrollRef.current;
              if (!el) return;
              el.scrollTop = el.scrollHeight;
              setStickToBottom(true);
              setUnseen(0);
            }}
            title="Jump to newest"
          >
            {unseen} new
          </button>
        ) : (
          <div className="text-[11px] text-text-secondary/70">auto-scroll {stickToBottom ? "on" : "off"}</div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-bg-primary/30"
        >
          {events.length === 0 ? (
            <div className="p-4 text-sm text-text-secondary">
              Waiting for `git:event`…
              <div className="mt-1 text-xs text-text-secondary/70">
                Commit in any tracked branch/worktree to see entries appear.
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {events.map((e) => {
                const selected = selectedId === e.id;
                const danger = e.eventType === "conflict_detected";
                const accent =
                  e.eventType === "commit"
                    ? "text-accent-blue"
                    : e.eventType === "merge_completed"
                      ? "text-accent-green"
                      : e.eventType === "branch_created"
                        ? "text-accent-green"
                        : e.eventType === "branch_deleted"
                          ? "text-accent-red"
                          : danger
                            ? "text-accent-orange"
                            : "text-text-secondary";

                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      className={[
                        "flex w-full items-start gap-3 px-3 py-2 text-left transition",
                        selected ? "bg-bg-hover" : "hover:bg-bg-hover/70",
                      ].join(" ")}
                      onClick={() => setSelectedId((cur) => (cur === e.id ? null : e.id))}
                    >
                      <div className={`mt-[2px] w-6 flex-none font-mono text-xs ${accent}`}>
                        {iconFor(e.eventType)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <div className="truncate text-xs font-semibold text-text-primary">
                            {labelFor(e.eventType)}
                            {e.branch ? (
                              <span className="ml-2 font-mono text-[11px] text-text-secondary">
                                {e.branch}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex-none font-mono text-[10px] text-text-secondary/70">
                            {timeOf(e.timestamp)}
                          </div>
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[11px] text-text-secondary">
                          {describe(e)}
                        </div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="hidden w-[340px] flex-none rounded-xl border border-border bg-bg-primary/30 p-3 lg:block">
          {selected ? (
            <>
              <div className="text-xs font-semibold text-text-primary">Details</div>
              <div className="mt-2 space-y-2 text-[12px] text-text-secondary">
                <div>
                  <span className="text-text-secondary/70">Type:</span>{" "}
                  <span className="font-mono">{selected.eventType}</span>
                </div>
                <div>
                  <span className="text-text-secondary/70">Time:</span>{" "}
                  <span className="font-mono">{selected.timestamp}</span>
                </div>
                {selected.branch ? (
                  <div>
                    <span className="text-text-secondary/70">Branch:</span>{" "}
                    <span className="font-mono">{selected.branch}</span>
                  </div>
                ) : null}
                {selected.sessionId != null ? (
                  <div>
                    <span className="text-text-secondary/70">Session:</span>{" "}
                    <span className="font-mono">#{selected.sessionId}</span>
                  </div>
                ) : null}
                {selected.hash ? (
                  <div>
                    <span className="text-text-secondary/70">Commit:</span>{" "}
                    <span className="font-mono">{selected.hash}</span>
                  </div>
                ) : null}
                {selected.message ? (
                  <div>
                    <span className="text-text-secondary/70">Message:</span>{" "}
                    <span className="font-mono">{selected.message}</span>
                  </div>
                ) : null}
                {selected.eventType === "commit" ? (
                  <div className="mt-3 rounded-lg border border-border bg-bg-secondary/60 p-3">
                    <div className="text-xs font-semibold text-text-primary">Diff</div>
                    <div className="mt-1 text-[12px] text-text-secondary">
                      Placeholder: open the Review panel to view structured diffs.
                    </div>
                  </div>
                ) : null}
                {selected.eventType === "conflict_detected" ? (
                  <div className="mt-3 rounded-lg border border-accent-orange/30 bg-accent-orange/10 p-3">
                    <div className="text-xs font-semibold text-accent-orange">Conflict detected</div>
                    <div className="mt-1 text-[12px] text-text-secondary">
                      Files: {(selected.conflictFiles ?? []).join(", ") || "unknown"}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : (
            <div className="text-sm text-text-secondary">Click an entry to inspect it.</div>
          )}
        </div>
      </div>
    </div>
  );
}
