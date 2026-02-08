import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";

import { settingsSet } from "../../lib/tauri-api";
import { useAppStore } from "../../lib/store";
import { isEditableTarget, stopEvent } from "../../lib/keybindings";
import { GitActivityFeed } from "./GitActivityFeed";
import { LocalhostSessions } from "./LocalhostSessions";
import { ReviewQueue } from "./ReviewQueue";

type PanelId = "cost" | "git" | "localhost" | "tasks" | "reviews";

type PanelDef = {
  id: PanelId;
  title: string;
  emoji: string;
  hint: string;
};

const PANELS: PanelDef[] = [
  { id: "cost", title: "Cost Tracker", emoji: "💰", hint: "Per-session tokens and totals" },
  { id: "git", title: "Git Activity", emoji: "📊", hint: "Commits, merges, conflicts" },
  { id: "localhost", title: "Localhost", emoji: "🌐", hint: "Run and preview branches/worktrees" },
  { id: "tasks", title: "Task Queue", emoji: "📋", hint: "Queue and progress" },
  { id: "reviews", title: "Review Queue", emoji: "🔍", hint: "Diffs and approvals" },
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function moveItem<T>(arr: T[], from: number, to: number) {
  if (from === to) return arr;
  const next = [...arr];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function dedupePanels(order: string[]) {
  const wanted = new Set(PANELS.map((p) => p.id));
  const out: PanelId[] = [];
  for (const id of order) {
    if (!wanted.has(id as PanelId)) continue;
    if (out.includes(id as PanelId)) continue;
    out.push(id as PanelId);
  }
  for (const p of PANELS) {
    if (!out.includes(p.id)) out.push(p.id);
  }
  return out;
}

export function BottomDrawer(props: { tauriAvailable: boolean; mode: "navigation" | "terminal" }) {
  const { tauriAvailable, mode } = props;

  const currentProject = useAppStore((s) => s.currentProject);
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);

  const savedHeight = settings?.ui?.drawerHeight ?? 250;
  const savedOrder = settings?.ui?.drawerPanelOrder ?? ["cost", "git", "tasks", "reviews"];

  const [panelOrder, setPanelOrder] = useState<PanelId[]>(() => dedupePanels(savedOrder));
  const [active, setActive] = useState<PanelId>(() => panelOrder[0] ?? "cost");
  const [height, setHeight] = useState(() => clamp(savedHeight, 140, 700));
  const [collapsed, setCollapsed] = useState(false);
  const lastExpandedHeightRef = useRef(height);

  const saveTimerRef = useRef<number | null>(null);

  // Keep local state aligned with settings changes coming from elsewhere (Settings panel).
  useEffect(() => {
    setPanelOrder(dedupePanels(savedOrder));
  }, [savedOrder.join("|")]);

  useEffect(() => {
    setHeight(clamp(savedHeight, 140, 700));
  }, [savedHeight]);

  useEffect(() => {
    if (!panelOrder.includes(active)) setActive(panelOrder[0] ?? "cost");
  }, [panelOrder, active]);

  const panelById = useMemo(() => {
    const m = new Map<PanelId, PanelDef>();
    for (const p of PANELS) m.set(p.id, p);
    return m;
  }, []);

  const orderedPanels = useMemo(() => panelOrder.map((id) => panelById.get(id)!).filter(Boolean), [panelOrder, panelById]);

  const schedulePersist = (nextHeight: number, nextOrder: PanelId[]) => {
    if (!settings) return;
    const next = {
      ...settings,
      ui: {
        ...settings.ui,
        drawerHeight: nextHeight,
        drawerPanelOrder: nextOrder,
      },
    };

    // Optimistic: update local store immediately, then persist.
    setSettings(next);

    if (!tauriAvailable) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      settingsSet(next)
        .then((saved) => setSettings(saved))
        .catch(() => {
          // Best-effort; UI still reflects the optimistic state.
        });
    }, 220);
  };

  const visibleHeight = collapsed ? 44 : height;
  const minHeight = 140;
  const maxHeight = 700;

  // Keyboard shortcut: Ctrl+j toggles drawer (navigation mode only).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (mode !== "navigation") return;
      if (isEditableTarget(e.target)) return;
      if (!(e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "j")) return;
      stopEvent(e);
      setCollapsed((v) => {
        const next = !v;
        if (!next) {
          setHeight((h) => {
            const restored = clamp(lastExpandedHeightRef.current || h, minHeight, maxHeight);
            schedulePersist(restored, panelOrder);
            return restored;
          });
        }
        return next;
      });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mode, panelOrder, tauriAvailable, settings]);

  const resizingRef = useRef<{
    startY: number;
    startHeight: number;
    pointerId: number;
  } | null>(null);

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    resizingRef.current = { startY: e.clientY, startHeight: height, pointerId: e.pointerId };
    setCollapsed(false);
  };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizingRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    const dy = r.startY - e.clientY;
    const next = clamp(r.startHeight + dy, minHeight, maxHeight);
    setHeight(next);
    lastExpandedHeightRef.current = next;
  };

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizingRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    resizingRef.current = null;
    const finalHeight = clamp(lastExpandedHeightRef.current || height, minHeight, maxHeight);
    schedulePersist(finalHeight, panelOrder);
  };

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      if (next) {
        lastExpandedHeightRef.current = height;
      } else {
        const restored = clamp(lastExpandedHeightRef.current || height, minHeight, maxHeight);
        setHeight(restored);
        schedulePersist(restored, panelOrder);
      }
      return next;
    });
  };

  const onDragStartTab = (e: ReactDragEvent<HTMLButtonElement>, id: PanelId) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const onDropTab = (e: ReactDragEvent<HTMLButtonElement>, overId: PanelId) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain") as PanelId;
    if (!fromId) return;
    if (fromId === overId) return;
    const from = panelOrder.indexOf(fromId);
    const to = panelOrder.indexOf(overId);
    if (from < 0 || to < 0) return;
    const next = moveItem(panelOrder, from, to);
    setPanelOrder(next);
    schedulePersist(height, next);
  };

  return (
    <div
      className="flex w-full flex-col overflow-hidden rounded-2xl border border-border bg-bg-secondary shadow-[0_18px_60px_rgba(0,0,0,0.35)]"
      style={{ height: visibleHeight }}
      aria-label="Bottom drawer"
    >
      <div
        className="relative h-3 w-full cursor-row-resize select-none"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
        onDoubleClick={toggleCollapsed}
        title="Drag to resize. Double-click to collapse/expand. (Ctrl+J)"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize drawer"
      >
        <div className="absolute inset-0 bg-gradient-to-b from-bg-primary/70 via-bg-primary/20 to-transparent" />
        <div className="absolute left-1/2 top-1/2 h-[3px] w-16 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border" />
      </div>

      <div className="flex items-center gap-1 border-b border-border bg-bg-tertiary px-2 py-2">
        {orderedPanels.map((p) => {
          const selected = active === p.id;
          return (
            <button
              key={p.id}
              type="button"
              draggable
              onDragStart={(e) => onDragStartTab(e, p.id)}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
              }}
              onDrop={(e) => onDropTab(e, p.id)}
              onClick={() => setActive(p.id)}
              className={[
                "group flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold tracking-tight transition",
                selected
                  ? "border-accent-blue/40 bg-bg-primary text-text-primary shadow-[0_10px_25px_rgba(0,0,0,0.35)]"
                  : "border-border bg-bg-secondary text-text-secondary hover:bg-bg-hover hover:text-text-primary",
              ].join(" ")}
              title={p.hint}
              aria-pressed={selected}
            >
              <span className="text-sm leading-none">{p.emoji}</span>
              <span>{p.title}</span>
              <span className="ml-1 hidden text-[10px] text-text-secondary/70 group-hover:inline">
                drag
              </span>
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2 pr-1">
          <button
            type="button"
            className="rounded-lg border border-border bg-bg-secondary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary"
            onClick={toggleCollapsed}
            title="Collapse/expand (Ctrl+J)"
          >
            {collapsed ? "Expand" : "Collapse"}
          </button>
        </div>
      </div>

      {collapsed ? (
        <div className="flex-1 bg-bg-secondary" />
      ) : (
        <div className="flex-1 overflow-auto bg-bg-secondary">
          <div className="p-4">
            {active === "git" ? (
              <GitActivityFeed tauriAvailable={tauriAvailable} projectPath={currentProject?.path ?? null} />
            ) : active === "localhost" ? (
              <LocalhostSessions tauriAvailable={tauriAvailable} projectPath={currentProject?.path ?? null} />
            ) : active === "reviews" ? (
              <ReviewQueue tauriAvailable={tauriAvailable} projectPath={currentProject?.path ?? null} />
            ) : (
              <>
                <div className="text-sm font-semibold text-text-primary">
                  {panelById.get(active)?.emoji} {panelById.get(active)?.title}
                </div>
                <div className="mt-1 text-xs text-text-secondary">
                  Placeholder panel. Content lands in later Phase 3 tasks.
                </div>

                <div className="mt-4 rounded-xl border border-border bg-bg-primary/40 p-4 text-sm text-text-secondary">
                  <div className="font-mono text-[12px] text-text-secondary/80">panelId: {active}</div>
                  <div className="mt-2">Tabs are draggable to reorder. Order is saved to settings.</div>
                  <div className="mt-1">
                    Resize from the top handle. Double-click the handle (or Ctrl+J) to collapse.
                  </div>
                  {!tauriAvailable ? (
                    <div className="mt-3 text-[12px] text-accent-orange">
                      Browser preview mode: panel order/height won&apos;t persist until Tauri is available.
                    </div>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
