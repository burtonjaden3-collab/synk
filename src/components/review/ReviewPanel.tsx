import { useEffect, useMemo, useState } from "react";

import { gitMerge, reviewSetDecision, reviewSetMergeStrategy, reviewSetStatus } from "../../lib/tauri-api";
import { useAppStore } from "../../lib/store";
import type { FileDiff, MergeStrategy, ReviewDecision, ReviewItem } from "../../lib/types";
import { CommentThread } from "./CommentThread";
import { DiffViewer } from "./DiffViewer";

function strategyLabel(s: MergeStrategy) {
  switch (s) {
    case "merge":
      return "Merge commit";
    case "squash":
      return "Squash";
    case "rebase":
      return "Rebase";
    default:
      return s;
  }
}

function decisionPill(decision: ReviewDecision | null | undefined) {
  switch (decision) {
    case "approved":
      return { text: "APPROVED", cls: "border-accent-green/40 bg-accent-green/10 text-accent-green" };
    case "rejected":
      return { text: "REJECTED", cls: "border-accent-red/40 bg-accent-red/10 text-accent-red" };
    case "changes_requested":
      return { text: "CHANGES", cls: "border-accent-orange/40 bg-accent-orange/10 text-accent-orange" };
    default:
      return { text: "UNDECIDED", cls: "border-border bg-bg-primary/40 text-text-secondary" };
  }
}

function statusPill(status: ReviewItem["status"]) {
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

function fileLabel(f: FileDiff) {
  const s =
    f.status === "added"
      ? { t: "A", cls: "border-accent-green/40 bg-accent-green/10 text-accent-green" }
      : f.status === "deleted"
        ? { t: "D", cls: "border-accent-red/40 bg-accent-red/10 text-accent-red" }
        : f.status === "renamed"
          ? { t: "R", cls: "border-accent-orange/40 bg-accent-orange/10 text-accent-orange" }
          : { t: "M", cls: "border-accent-blue/40 bg-accent-blue/10 text-accent-blue" };
  return s;
}

export function ReviewPanel(props: {
  tauriAvailable: boolean;
  projectPath: string;
  review: ReviewItem;
  onReviewUpdated: (it: ReviewItem) => void;
}) {
  const { tauriAvailable, projectPath, review, onReviewUpdated } = props;

  const settings = useAppStore((s) => s.settings);
  const defaultStrategy = settings?.git?.defaultMergeStrategy ?? "merge";

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<string[] | null>(null);

  const mergeStrategy: MergeStrategy = (review.mergeStrategy ?? defaultStrategy) as MergeStrategy;

  useEffect(() => {
    // Default to first file when switching reviews.
    setSelectedFile(review.files[0]?.path ?? null);
    setSelectedLine(null);
    setErr(null);
    setConflicts(null);
  }, [review.id]);

  const file = useMemo(() => (selectedFile ? review.files.find((f) => f.path === selectedFile) ?? null : null), [review.files, selectedFile]);

  const topStatus = statusPill(review.status);
  const topDecision = decisionPill(review.reviewDecision ?? null);

  const canAct = tauriAvailable && !busy && review.status !== "merged" && review.status !== "merging";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border bg-bg-secondary px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-mono text-[12px] font-semibold text-text-primary">
              {review.branch} <span className="text-text-secondary">→</span> {review.baseBranch}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
              <span className="rounded-md border border-border bg-bg-tertiary px-2 py-0.5 font-mono">
                {review.filesChanged} file{review.filesChanged === 1 ? "" : "s"}
              </span>
              <span className="text-accent-green">+{review.additions}</span>
              <span className="text-accent-red">−{review.deletions}</span>
              <span className="text-text-secondary/60">id {review.id}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className={["rounded-full border px-2 py-1 font-mono text-[10px]", topStatus.cls].join(" ")}>
              {topStatus.text}
            </span>
            <span className={["rounded-full border px-2 py-1 font-mono text-[10px]", topDecision.cls].join(" ")}>
              {topDecision.text}
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-[11px] font-semibold text-text-secondary">
            Merge strategy
            <select
              className="h-8 rounded-lg border border-border bg-bg-tertiary px-2 font-mono text-[12px] text-text-primary disabled:opacity-60"
              disabled={!tauriAvailable || busy}
              value={mergeStrategy}
              onChange={async (e) => {
                if (!tauriAvailable) return;
                const next = e.target.value as MergeStrategy;
                setBusy(true);
                setErr(null);
                try {
                  const updated = await reviewSetMergeStrategy(projectPath, review.id, next);
                  onReviewUpdated(updated);
                } catch (e2) {
                  setErr(e2 instanceof Error ? e2.message : String(e2));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <option value="merge">{strategyLabel("merge")}</option>
              <option value="squash">{strategyLabel("squash")}</option>
              <option value="rebase">{strategyLabel("rebase")}</option>
            </select>
          </label>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-xl border border-accent-green/45 bg-accent-green/10 px-3 py-2 text-[11px] font-semibold text-accent-green hover:bg-accent-green/15 disabled:opacity-60"
              disabled={!canAct}
              title="Approve and merge"
              onClick={async () => {
                if (!tauriAvailable) return;
                setBusy(true);
                setErr(null);
                setConflicts(null);
                try {
                  const decided = await reviewSetDecision(projectPath, review.id, "approved");
                  onReviewUpdated(decided);

                  const merging = await reviewSetStatus(projectPath, review.id, "merging");
                  onReviewUpdated(merging);

                  const res = await gitMerge(projectPath, review.branch, review.baseBranch, mergeStrategy);
                  if (res.success) {
                    const merged = await reviewSetStatus(projectPath, review.id, "merged");
                    onReviewUpdated(merged);
                  } else {
                    const conflict = await reviewSetStatus(projectPath, review.id, "merge_conflict");
                    onReviewUpdated(conflict);
                    setConflicts(res.conflictFiles ?? null);
                  }
                } catch (e2) {
                  setErr(e2 instanceof Error ? e2.message : String(e2));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Approve
            </button>

            <button
              type="button"
              className="rounded-xl border border-accent-red/45 bg-accent-red/10 px-3 py-2 text-[11px] font-semibold text-accent-red hover:bg-accent-red/15 disabled:opacity-60"
              disabled={!canAct}
              title="Reject"
              onClick={async () => {
                if (!tauriAvailable) return;
                setBusy(true);
                setErr(null);
                try {
                  const updated = await reviewSetDecision(projectPath, review.id, "rejected");
                  onReviewUpdated(updated);
                } catch (e2) {
                  setErr(e2 instanceof Error ? e2.message : String(e2));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Reject
            </button>

            <button
              type="button"
              className="rounded-xl border border-accent-orange/45 bg-accent-orange/10 px-3 py-2 text-[11px] font-semibold text-accent-orange hover:bg-accent-orange/15 disabled:opacity-60"
              disabled={!canAct}
              title="Request changes"
              onClick={async () => {
                if (!tauriAvailable) return;
                setBusy(true);
                setErr(null);
                try {
                  const updated = await reviewSetDecision(projectPath, review.id, "changes_requested");
                  onReviewUpdated(updated);
                } catch (e2) {
                  setErr(e2 instanceof Error ? e2.message : String(e2));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Request changes
            </button>
          </div>
        </div>

        {err ? (
          <div className="mt-3 rounded-xl border border-accent-red/40 bg-accent-red/10 p-3 text-sm text-accent-red">
            {err}
          </div>
        ) : null}

        {conflicts && conflicts.length > 0 ? (
          <div className="mt-3 rounded-xl border border-accent-red/40 bg-accent-red/10 p-3 text-sm text-accent-red">
            Merge conflict detected in {conflicts.length} file{conflicts.length === 1 ? "" : "s"}:
            <ul className="mt-2 list-disc pl-5 font-mono text-[12px] text-accent-red/90">
              {conflicts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        <div className="grid h-full min-h-0 grid-cols-[280px_1fr]">
          <div className="min-h-0 border-r border-border bg-bg-primary/10">
            <div className="border-b border-border bg-bg-tertiary px-3 py-2 text-xs font-semibold text-text-secondary">
              Files
            </div>
            <div className="min-h-0 overflow-auto">
              <ul className="divide-y divide-border/60">
                {review.files.map((f) => {
                  const sel = f.path === selectedFile;
                  const badge = fileLabel(f);
                  return (
                    <li key={f.path}>
                      <button
                        type="button"
                        className={[
                          "flex w-full items-start gap-2 px-3 py-2 text-left transition",
                          sel ? "bg-bg-hover" : "hover:bg-bg-hover/70",
                        ].join(" ")}
                        onClick={() => {
                          setSelectedFile(f.path);
                          setSelectedLine(null);
                        }}
                      >
                        <span className={["mt-0.5 shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px]", badge.cls].join(" ")}>
                          {badge.t}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-mono text-[12px] text-text-primary">{f.path}</div>
                          {f.status === "renamed" && f.oldPath ? (
                            <div className="truncate font-mono text-[11px] text-text-secondary/70">
                              from {f.oldPath}
                            </div>
                          ) : (
                            <div className="font-mono text-[11px] text-text-secondary/70">
                              {f.hunks.length} hunk{f.hunks.length === 1 ? "" : "s"}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="min-h-0 overflow-hidden">
            {file ? (
              <div className="grid h-full min-h-0 grid-cols-[1fr_340px]">
                <div className="min-h-0 overflow-hidden border-r border-border">
                  <DiffViewer
                    file={file}
                    comments={review.comments ?? []}
                    selectedLine={selectedLine}
                    onSelectLine={(filePath, lineNumber) => {
                      setSelectedFile(filePath);
                      setSelectedLine(lineNumber);
                    }}
                  />
                </div>
                <div className="min-h-0 overflow-hidden">
                  <CommentThread
                    tauriAvailable={tauriAvailable}
                    projectPath={projectPath}
                    review={review}
                    filePath={selectedFile}
                    lineNumber={selectedLine}
                    onReviewUpdated={onReviewUpdated}
                  />
                </div>
              </div>
            ) : (
              <div className="p-4 text-sm text-text-secondary">No file selected.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

