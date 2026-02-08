export type InputMode = "navigation" | "terminal";

export type Direction = "left" | "right" | "up" | "down";

export function gridForCount(count: number) {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  if (count <= 9) return { cols: 3, rows: 3 };
  return { cols: 4, rows: 3 };
}

export function moveIndex(current: number, dir: Direction, cols: number, count: number) {
  if (count <= 0) return 0;
  const idx = clampIndex(current, count);

  switch (dir) {
    case "left":
      return idx % cols === 0 ? idx : idx - 1;
    case "right": {
      const next = idx + 1;
      if (next >= count) return idx;
      return next % cols === 0 ? idx : next;
    }
    case "up":
      return idx - cols >= 0 ? idx - cols : idx;
    case "down":
      return idx + cols < count ? idx + cols : idx;
  }
}

export function clampIndex(idx: number, count: number) {
  if (count <= 0) return 0;
  if (idx < 0) return 0;
  if (idx >= count) return count - 1;
  return idx;
}

export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

export function keyToSessionIndex(key: string): number | null {
  // 1-9 jump to panes 1-9, 0 jumps to pane 10 (index 9).
  if (key >= "1" && key <= "9") return Number(key) - 1;
  if (key === "0") return 9;
  return null;
}

export function keyEventToPrintableChar(e: KeyboardEvent): string | null {
  // Only handle simple printable characters. If we can't confidently map it,
  // let xterm handle the key and only inject ESC ourselves.
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  if (e.key.length !== 1) return null;
  return e.key;
}

export function stopEvent(e: KeyboardEvent) {
  e.preventDefault();
  e.stopPropagation();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (e as any).stopImmediatePropagation?.();
}

export function isSidebarToggle(e: KeyboardEvent): boolean {
  // Reserved global app chrome hotkey (sidebar is app-level, not per-pane).
  return e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "e";
}

export function isSettingsToggle(e: KeyboardEvent): boolean {
  // Global app chrome hotkey.
  const ctrlOrMeta = (e.ctrlKey && !e.metaKey) || (!e.ctrlKey && e.metaKey);
  if (!ctrlOrMeta || e.altKey) return false;

  // Prefer code for layout-independence; fallback to key.
  if (e.code === "Comma") return true;
  return e.key === "," || e.key === "<";
}
