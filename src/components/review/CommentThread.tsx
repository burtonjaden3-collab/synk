import { useMemo, useState } from "react";

import { reviewAddComment, reviewResolveComment } from "../../lib/tauri-api";
import type { ReviewComment, ReviewItem } from "../../lib/types";

function fmtTime(ts: string) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function byCreatedAt(a: ReviewComment, b: ReviewComment) {
  return a.createdAt.localeCompare(b.createdAt);
}

export function CommentThread(props: {
  tauriAvailable: boolean;
  projectPath: string;
  review: ReviewItem;
  filePath: string | null;
  lineNumber: number | null;
  onReviewUpdated: (it: ReviewItem) => void;
}) {
  const { tauriAvailable, projectPath, review, filePath, lineNumber, onReviewUpdated } = props;

  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const thread = useMemo(() => {
    if (!filePath || !lineNumber) return [];
    return (review.comments ?? []).filter((c) => c.filePath === filePath && c.lineNumber === lineNumber).sort(byCreatedAt);
  }, [review.comments, filePath, lineNumber]);

  if (!filePath || !lineNumber) {
    return (
      <div className="h-full p-3 text-sm text-text-secondary">
        Click a line number to start a comment thread.
        <div className="mt-2 text-xs text-text-secondary/70">
          Comments anchor to the new-file line number (additions/context lines).
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border bg-bg-tertiary px-3 py-2">
        <div className="truncate font-mono text-[12px] font-semibold text-text-primary">
          {filePath}:{lineNumber}
        </div>
        <div className="mt-0.5 text-[11px] text-text-secondary">
          {thread.length} comment{thread.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {thread.length === 0 ? (
          <div className="rounded-xl border border-border bg-bg-primary/20 p-3 text-sm text-text-secondary">
            No comments yet.
          </div>
        ) : (
          <ul className="space-y-2">
            {thread.map((c) => (
              <li
                key={c.id}
                className={[
                  "rounded-xl border p-3",
                  c.resolved ? "border-border bg-bg-primary/10 opacity-75" : "border-border bg-bg-primary/25",
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-mono text-[11px] text-text-secondary">
                      {c.author} · {fmtTime(c.createdAt)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={[
                      "shrink-0 rounded-lg border px-2 py-1 text-[11px] font-semibold",
                      c.resolved
                        ? "border-border bg-bg-secondary text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                        : "border-accent-green/40 bg-accent-green/10 text-accent-green hover:bg-accent-green/15",
                    ].join(" ")}
                    disabled={busy || !tauriAvailable}
                    title={tauriAvailable ? "Toggle resolved" : "Requires Tauri"}
                    onClick={async () => {
                      if (!tauriAvailable) return;
                      setBusy(true);
                      setErr(null);
                      try {
                        const updated = await reviewResolveComment(projectPath, review.id, c.id, !c.resolved);
                        onReviewUpdated(updated);
                      } catch (e) {
                        setErr(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    {c.resolved ? "Reopen" : "Resolve"}
                  </button>
                </div>
                <div className="mt-2 whitespace-pre-wrap text-sm text-text-primary">{c.body}</div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {err ? (
        <div className="border-t border-accent-red/40 bg-accent-red/10 px-3 py-2 text-xs text-accent-red">
          {err}
        </div>
      ) : null}

      <form
        className="border-t border-border bg-bg-secondary p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!tauriAvailable) return;
          if (!body.trim()) return;
          setBusy(true);
          setErr(null);
          try {
            const updated = await reviewAddComment(projectPath, review.id, filePath, lineNumber, body.trim(), "user");
            onReviewUpdated(updated);
            setBody("");
          } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : String(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <textarea
          className="h-24 w-full resize-none rounded-xl border border-border bg-bg-tertiary p-2 font-mono text-[12px] text-text-primary outline-none focus:border-accent-blue/40"
          placeholder={tauriAvailable ? "Add a line comment…" : "Comments require Tauri."}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          disabled={busy || !tauriAvailable}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="text-[11px] text-text-secondary/70">
            Tip: keep feedback concrete (what to change, why, and expected outcome).
          </div>
          <button
            type="submit"
            className="rounded-xl border border-accent-blue/45 bg-accent-blue/10 px-3 py-2 text-[11px] font-semibold text-accent-blue hover:bg-accent-blue/15 disabled:opacity-60"
            disabled={busy || !tauriAvailable || !body.trim()}
          >
            Add comment
          </button>
        </div>
      </form>
    </div>
  );
}

