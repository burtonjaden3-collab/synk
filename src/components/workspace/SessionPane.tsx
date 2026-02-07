import { useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "xterm";

import { sessionResize, sessionWrite } from "../../lib/tauri-api";
import type { SessionInfo } from "../../lib/types";

function agentBadge(agentType: SessionInfo["agentType"]) {
  switch (agentType) {
    case "claude_code":
      return { label: "Claude", color: "bg-accent-purple/20 text-accent-purple border-accent-purple/40" };
    case "gemini_cli":
      return { label: "Gemini", color: "bg-accent-blue/20 text-accent-blue border-accent-blue/40" };
    case "codex":
      return { label: "Codex", color: "bg-accent-green/15 text-accent-green border-accent-green/40" };
    case "terminal":
    default:
      return { label: "Terminal", color: "bg-bg-primary text-text-secondary border-border" };
  }
}

function decodeB64ToBytes(dataB64: string) {
  const bin = atob(dataB64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function SessionPane(props: {
  session: SessionInfo;
  registerOutputHandler: (sessionId: number, handler: (dataB64: string) => void) => void;
  unregisterOutputHandler: (sessionId: number) => void;
  onDestroySession: (sessionId: number) => void | Promise<void>;
}) {
  const { session } = props;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermHostRef = useRef<HTMLDivElement | null>(null);

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const decoderRef = useRef<TextDecoder | null>(null);

  const resizeTimerRef = useRef<number | null>(null);
  const [focused, setFocused] = useState(false);

  const badge = useMemo(() => agentBadge(session.agentType), [session.agentType]);
  const title = useMemo(() => `Pane ${session.paneIndex + 1}`, [session.paneIndex]);

  useEffect(() => {
    const host = xtermHostRef.current;
    if (!host) return;

    const container = containerRef.current;

    const fit = new FitAddon();
    const term = new Terminal({
      fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: false,
      theme: {
        background: "#1e1e2e",
        foreground: "#e0e0e8",
        cursor: "#58a6ff",
        selectionBackground: "#353548",
      },
      scrollback: 5000,
    });

    decoderRef.current = new TextDecoder();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    const writeDisposable = term.onData((data) => {
      sessionWrite(session.sessionId, data).catch(() => {});
    });

    const onWindowMouseDown = (ev: MouseEvent) => {
      if (!container) return;
      if (!container.contains(ev.target as Node)) {
        setFocused(false);
      }
    };
    window.addEventListener("mousedown", onWindowMouseDown, true);

    termRef.current = term;
    fitRef.current = fit;

    // Register per-session output handler (Workspace keeps a single Tauri listener).
    props.registerOutputHandler(session.sessionId, (dataB64) => {
      const t = termRef.current;
      const dec = decoderRef.current;
      if (!t || !dec) return;
      const bytes = decodeB64ToBytes(dataB64);
      const text = dec.decode(bytes, { stream: true });
      t.write(text);
    });

    const ro = new ResizeObserver(() => {
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }

      resizeTimerRef.current = window.setTimeout(() => {
        const t = termRef.current;
        const f = fitRef.current;
        if (!t || !f) return;

        f.fit();
        sessionResize(session.sessionId, t.cols, t.rows).catch(() => {});
      }, 80);
    });

    ro.observe(host);

    return () => {
      props.unregisterOutputHandler(session.sessionId);
      ro.disconnect();

      window.removeEventListener("mousedown", onWindowMouseDown, true);

      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
      }

      writeDisposable.dispose();

      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      decoderRef.current = null;
    };
    // session.sessionId intentionally pins the terminal instance to the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sessionId]);

  return (
    <div
      ref={containerRef}
      className={[
        "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-bg-secondary shadow-[0_18px_50px_rgba(0,0,0,0.35)]",
        focused ? "border-accent-blue/70" : "border-border",
      ].join(" ")}
      onMouseDown={() => {
        termRef.current?.focus();
      }}
    >
      <div className="flex h-9 items-center gap-2 border-b border-border bg-bg-tertiary px-3">
        <div
          className={[
            "rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide",
            badge.color,
          ].join(" ")}
        >
          {badge.label}
        </div>
        <div className="text-xs font-medium text-text-primary">{title}</div>
        <div className="ml-auto flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-accent-green" title="active" />
          <button
            className="rounded-md border border-border bg-bg-primary px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              props.onDestroySession(session.sessionId);
            }}
            title="Destroy session"
          >
            Close
          </button>
        </div>
      </div>
      <div className="relative flex-1 bg-bg-primary">
        <div ref={xtermHostRef} className="synk-xterm absolute inset-0" />
      </div>
    </div>
  );
}
