import { useMemo, useState } from "react";

import type { FileDiff, ReviewComment } from "../../lib/types";

type ViewMode = "unified" | "split";

type LineKind = "context" | "addition" | "deletion";

type UnifiedRow =
  | {
      kind: "hunk";
      key: string;
      label: string;
    }
  | {
      kind: "line";
      key: string;
      lineKind: LineKind;
      oldNo: number | null;
      newNo: number | null;
      content: string;
    };

type SplitRow =
  | { kind: "hunk"; key: string; label: string }
  | {
      kind: "row";
      key: string;
      left: { lineKind: LineKind; no: number | null; content: string } | null;
      right: { lineKind: LineKind; no: number | null; content: string } | null;
    };

function extOf(path: string) {
  const i = path.lastIndexOf(".");
  if (i < 0) return "";
  return path.slice(i + 1).toLowerCase();
}

function isWordChar(ch: string) {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "$";
}

function tokenizeLine(line: string) {
  // Token categories are intentionally small; this is a lightweight in-house highlighter.
  const out: { t: "text" | "word" | "string" | "number" | "comment"; v: string }[] = [];
  let i = 0;
  let buf = "";
  let mode: "none" | "squote" | "dquote" | "bquote" = "none";

  const flushText = () => {
    if (!buf) return;
    out.push({ t: "text", v: buf });
    buf = "";
  };

  while (i < line.length) {
    const ch = line[i]!;

    if (mode === "none") {
      const next = line[i + 1];
      if (ch === "/" && next === "/") {
        flushText();
        out.push({ t: "comment", v: line.slice(i) });
        return out;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        flushText();
        mode = ch === "'" ? "squote" : ch === '"' ? "dquote" : "bquote";
        let j = i + 1;
        while (j < line.length) {
          const c = line[j]!;
          if (c === "\\") {
            j += 2;
            continue;
          }
          if ((mode === "squote" && c === "'") || (mode === "dquote" && c === '"') || (mode === "bquote" && c === "`")) {
            j += 1;
            break;
          }
          j += 1;
        }
        out.push({ t: "string", v: line.slice(i, j) });
        i = j;
        mode = "none";
        continue;
      }

      // Numbers (simple).
      if ((ch >= "0" && ch <= "9") || (ch === "." && next && next >= "0" && next <= "9")) {
        flushText();
        let j = i + 1;
        while (j < line.length) {
          const c = line[j]!;
          if (!((c >= "0" && c <= "9") || c === "." || c === "_" || c === "x" || c === "X" || (c >= "a" && c <= "f") || (c >= "A" && c <= "F"))) {
            break;
          }
          j += 1;
        }
        out.push({ t: "number", v: line.slice(i, j) });
        i = j;
        continue;
      }

      // Words.
      if (isWordChar(ch) && !(ch >= "0" && ch <= "9")) {
        flushText();
        let j = i + 1;
        while (j < line.length && isWordChar(line[j]!)) j += 1;
        out.push({ t: "word", v: line.slice(i, j) });
        i = j;
        continue;
      }

      buf += ch;
      i += 1;
      continue;
    }

    // Unreachable (we handle strings in one go above); keep safe.
    buf += ch;
    i += 1;
  }

  flushText();
  return out;
}

function renderHighlighted(line: string, ext: string) {
  const kw =
    ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx"
      ? new Set([
          "const",
          "let",
          "var",
          "function",
          "return",
          "import",
          "from",
          "export",
          "default",
          "type",
          "interface",
          "class",
          "new",
          "if",
          "else",
          "for",
          "while",
          "switch",
          "case",
          "break",
          "continue",
          "try",
          "catch",
          "finally",
          "throw",
          "await",
          "async",
          "extends",
          "implements",
          "public",
          "private",
          "protected",
          "readonly",
          "as",
          "in",
          "of",
          "null",
          "undefined",
          "true",
          "false",
        ])
      : new Set<string>();

  const tokens = tokenizeLine(line);
  return tokens.map((tok, idx) => {
    if (tok.t === "comment") {
      return (
        <span key={idx} className="text-text-secondary/80">
          {tok.v}
        </span>
      );
    }
    if (tok.t === "string") {
      return (
        <span key={idx} className="text-accent-orange/90">
          {tok.v}
        </span>
      );
    }
    if (tok.t === "number") {
      return (
        <span key={idx} className="text-accent-green/90">
          {tok.v}
        </span>
      );
    }
    if (tok.t === "word" && kw.has(tok.v)) {
      return (
        <span key={idx} className="text-accent-purple/90">
          {tok.v}
        </span>
      );
    }
    return <span key={idx}>{tok.v}</span>;
  });
}

function bgFor(lineKind: LineKind) {
  switch (lineKind) {
    case "addition":
      return "bg-accent-green/10";
    case "deletion":
      return "bg-accent-red/10";
    default:
      return "";
  }
}

function borderFor(lineKind: LineKind) {
  switch (lineKind) {
    case "addition":
      return "border-l-accent-green/50";
    case "deletion":
      return "border-l-accent-red/50";
    default:
      return "border-l-border/40";
  }
}

function buildUnifiedRows(file: FileDiff): UnifiedRow[] {
  const out: UnifiedRow[] = [];
  for (let hi = 0; hi < file.hunks.length; hi += 1) {
    const h = file.hunks[hi]!;
    out.push({
      kind: "hunk",
      key: `hunk-${hi}-${h.oldStart}-${h.newStart}`,
      label: `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`,
    });

    let oldNo = h.oldStart;
    let newNo = h.newStart;
    for (let li = 0; li < h.lines.length; li += 1) {
      const l = h.lines[li]!;
      if (l.type === "context") {
        out.push({
          kind: "line",
          key: `l-${hi}-${li}-${oldNo}-${newNo}`,
          lineKind: "context",
          oldNo,
          newNo,
          content: l.content,
        });
        oldNo += 1;
        newNo += 1;
      } else if (l.type === "addition") {
        out.push({
          kind: "line",
          key: `l-${hi}-${li}-a-${newNo}`,
          lineKind: "addition",
          oldNo: null,
          newNo,
          content: l.content,
        });
        newNo += 1;
      } else {
        out.push({
          kind: "line",
          key: `l-${hi}-${li}-d-${oldNo}`,
          lineKind: "deletion",
          oldNo,
          newNo: null,
          content: l.content,
        });
        oldNo += 1;
      }
    }
  }
  return out;
}

function buildSplitRows(file: FileDiff): SplitRow[] {
  const out: SplitRow[] = [];

  for (let hi = 0; hi < file.hunks.length; hi += 1) {
    const h = file.hunks[hi]!;
    out.push({
      kind: "hunk",
      key: `hunk-${hi}-${h.oldStart}-${h.newStart}`,
      label: `@@ -${h.oldStart},${h.oldCount} +${h.newStart},${h.newCount} @@`,
    });

    let oldNo = h.oldStart;
    let newNo = h.newStart;

    const pendingDel: { no: number; content: string }[] = [];
    const pendingAdd: { no: number; content: string }[] = [];

    const flush = () => {
      const n = Math.max(pendingDel.length, pendingAdd.length);
      for (let i = 0; i < n; i += 1) {
        const d = pendingDel[i] ?? null;
        const a = pendingAdd[i] ?? null;
        out.push({
          kind: "row",
          key: `pair-${hi}-${out.length}-${d?.no ?? "x"}-${a?.no ?? "y"}`,
          left: d ? { lineKind: "deletion", no: d.no, content: d.content } : null,
          right: a ? { lineKind: "addition", no: a.no, content: a.content } : null,
        });
      }
      pendingDel.length = 0;
      pendingAdd.length = 0;
    };

    for (let li = 0; li < h.lines.length; li += 1) {
      const l = h.lines[li]!;
      if (l.type === "context") {
        flush();
        out.push({
          kind: "row",
          key: `ctx-${hi}-${li}-${oldNo}-${newNo}`,
          left: { lineKind: "context", no: oldNo, content: l.content },
          right: { lineKind: "context", no: newNo, content: l.content },
        });
        oldNo += 1;
        newNo += 1;
      } else if (l.type === "addition") {
        pendingAdd.push({ no: newNo, content: l.content });
        newNo += 1;
      } else {
        pendingDel.push({ no: oldNo, content: l.content });
        oldNo += 1;
      }
    }

    flush();
  }

  return out;
}

function commentCountFor(comments: ReviewComment[], filePath: string, lineNumber: number) {
  let n = 0;
  for (const c of comments) {
    if (c.filePath !== filePath) continue;
    if (c.lineNumber !== lineNumber) continue;
    if (c.resolved) continue;
    n += 1;
  }
  return n;
}

export function DiffViewer(props: {
  file: FileDiff;
  comments: ReviewComment[];
  onSelectLine: (filePath: string, lineNumber: number) => void;
  selectedLine: number | null;
}) {
  const { file, comments, onSelectLine, selectedLine } = props;

  const [mode, setMode] = useState<ViewMode>("split");
  const ext = useMemo(() => extOf(file.path), [file.path]);

  const unified = useMemo(() => buildUnifiedRows(file), [file]);
  const split = useMemo(() => buildSplitRows(file), [file]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-bg-tertiary px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-[12px] font-semibold text-text-primary">{file.path}</div>
          <div className="mt-0.5 text-[11px] text-text-secondary">
            {file.status.toUpperCase()} · {file.hunks.length} hunk{file.hunks.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 rounded-xl border border-border bg-bg-secondary p-1">
          <button
            type="button"
            className={[
              "rounded-lg px-2 py-1 text-[11px] font-semibold",
              mode === "split" ? "bg-bg-primary text-text-primary" : "text-text-secondary hover:text-text-primary",
            ].join(" ")}
            onClick={() => setMode("split")}
            aria-pressed={mode === "split"}
            title="Side-by-side"
          >
            Split
          </button>
          <button
            type="button"
            className={[
              "rounded-lg px-2 py-1 text-[11px] font-semibold",
              mode === "unified" ? "bg-bg-primary text-text-primary" : "text-text-secondary hover:text-text-primary",
            ].join(" ")}
            onClick={() => setMode("unified")}
            aria-pressed={mode === "unified"}
            title="Unified diff"
          >
            Unified
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {mode === "unified" ? (
          <div className="font-mono text-[12px] leading-5 text-text-primary">
            {unified.map((r) => {
              if (r.kind === "hunk") {
                return (
                  <div key={r.key} className="sticky top-0 z-10 border-y border-border bg-bg-secondary/90 px-3 py-1 text-[11px] text-text-secondary backdrop-blur">
                    {r.label}
                  </div>
                );
              }

              const cc = r.newNo ? commentCountFor(comments, file.path, r.newNo) : 0;
              const selected = r.newNo !== null && selectedLine === r.newNo;

              return (
                <div
                  key={r.key}
                  className={[
                    "grid grid-cols-[56px_56px_1fr] items-stretch border-l-2",
                    borderFor(r.lineKind),
                    bgFor(r.lineKind),
                    selected ? "outline outline-1 outline-accent-blue/40" : "",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    className={[
                      "relative flex items-center justify-end gap-2 px-2 text-text-secondary hover:text-text-primary",
                      r.newNo ? "cursor-pointer" : "cursor-default opacity-50",
                    ].join(" ")}
                    onClick={() => {
                      if (!r.newNo) return;
                      onSelectLine(file.path, r.newNo);
                    }}
                    title={r.newNo ? "Click to comment" : "No new-line anchor for deletions"}
                  >
                    <span className="tabular-nums">{r.oldNo ?? ""}</span>
                  </button>
                  <button
                    type="button"
                    className={[
                      "relative flex items-center justify-end gap-2 px-2 text-text-secondary hover:text-text-primary",
                      r.newNo ? "cursor-pointer" : "cursor-default opacity-50",
                    ].join(" ")}
                    onClick={() => {
                      if (!r.newNo) return;
                      onSelectLine(file.path, r.newNo);
                    }}
                    title={r.newNo ? "Click to comment" : "No new-line anchor for deletions"}
                  >
                    <span className="tabular-nums">{r.newNo ?? ""}</span>
                    {cc > 0 ? <span className="h-1.5 w-1.5 rounded-full bg-accent-orange" title={`${cc} unresolved comment${cc === 1 ? "" : "s"}`} /> : null}
                  </button>
                  <div className="min-w-0 px-3 py-[1px] whitespace-pre">
                    {renderHighlighted(r.content, ext)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="font-mono text-[12px] leading-5 text-text-primary">
            {split.map((r) => {
              if (r.kind === "hunk") {
                return (
                  <div key={r.key} className="sticky top-0 z-10 border-y border-border bg-bg-secondary/90 px-3 py-1 text-[11px] text-text-secondary backdrop-blur">
                    {r.label}
                  </div>
                );
              }

              const left = r.left;
              const right = r.right;
              const rightNo = right?.no ?? null;
              const cc = rightNo ? commentCountFor(comments, file.path, rightNo) : 0;
              const selected = rightNo !== null && selectedLine === rightNo;

              return (
                <div
                  key={r.key}
                  className={[
                    "grid grid-cols-[56px_1fr_56px_1fr] items-stretch border-l-2",
                    selected ? "outline outline-1 outline-accent-blue/40" : "border-l-border/40",
                  ].join(" ")}
                >
                  <div className={["flex items-center justify-end px-2 text-text-secondary", left ? "" : "opacity-40"].join(" ")}>
                    <span className="tabular-nums">{left?.no ?? ""}</span>
                  </div>
                  <div className={["min-w-0 px-3 py-[1px] whitespace-pre", left ? bgFor(left.lineKind) : "", left ? "" : "opacity-40"].join(" ")}>
                    {left ? renderHighlighted(left.content, ext) : ""}
                  </div>

                  <button
                    type="button"
                    className={[
                      "relative flex items-center justify-end gap-2 px-2 text-text-secondary hover:text-text-primary",
                      rightNo ? "cursor-pointer" : "cursor-default opacity-40 hover:text-text-secondary",
                    ].join(" ")}
                    onClick={() => {
                      if (!rightNo) return;
                      onSelectLine(file.path, rightNo);
                    }}
                    title={rightNo ? "Click to comment" : "No new-line anchor for deletions"}
                  >
                    <span className="tabular-nums">{rightNo ?? ""}</span>
                    {cc > 0 ? <span className="h-1.5 w-1.5 rounded-full bg-accent-orange" title={`${cc} unresolved comment${cc === 1 ? "" : "s"}`} /> : null}
                  </button>
                  <div className={["min-w-0 px-3 py-[1px] whitespace-pre", right ? bgFor(right.lineKind) : "", right ? "" : "opacity-40"].join(" ")}>
                    {right ? renderHighlighted(right.content, ext) : ""}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

