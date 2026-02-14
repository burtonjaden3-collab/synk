import { useEffect, useState } from "react";

import type { DetectedAgent, OnboardingScanResult } from "../../lib/types";
import { onboardingScan } from "../../lib/tauri-api";

function statusDot(ok: boolean): string {
  return ok ? "✅" : "❌";
}

function agentLabel(t: DetectedAgent["agentType"]): string {
  switch (t) {
    case "claude_code":
      return "Claude Code";
    case "gemini_cli":
      return "Gemini CLI";
    case "codex":
      return "OpenAI Codex";
    case "openrouter":
      return "OpenRouter";
    case "terminal":
      return "Terminal";
    default:
      return t;
  }
}

function agentLine(a: DetectedAgent): string {
  const label = agentLabel(a.agentType);
  if (a.found) {
    return `${statusDot(true)} ${label}  at ${a.path ?? a.command}`;
  }
  return `${statusDot(false)} ${label}  not found`;
}

type AgentDetectionProps = {
  refreshToken?: number;
};

export function AgentDetection(props: AgentDetectionProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scan, setScan] = useState<OnboardingScanResult | null>(null);

  const refresh = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await onboardingScan();
      setScan(res);
    } catch (e) {
      setError(String(e));
      setScan(null);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    refresh().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.refreshToken]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-lg font-semibold tracking-tight">Agent detection</div>
          <div className="mt-1 text-sm text-text-secondary">
            Synk looks for common CLIs via <span className="font-mono">which</span> (or <span className="font-mono">where</span> on Windows).
          </div>
        </div>
        <button
          className="rounded-lg border border-border bg-bg-tertiary px-3 py-2 text-xs font-semibold text-text-primary hover:bg-bg-hover disabled:opacity-60"
          disabled={busy}
          onClick={() => refresh().catch(() => {})}
          type="button"
        >
          {busy ? "Scanning..." : "Rescan"}
        </button>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-accent-red/40 bg-bg-tertiary px-4 py-3 text-sm text-accent-red">
          {error}
        </div>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-bg-secondary p-4">
          <div className="text-sm font-semibold">Coding agents</div>
          <div className="mt-2 text-xs text-text-secondary">
            If nothing is installed, Plain Terminal always works.
          </div>
          <div className="mt-4 space-y-2">
            {(scan?.agents ?? []).map((a) => (
              <div
                key={a.agentType}
                className="rounded-xl border border-border bg-bg-tertiary px-3 py-2 font-mono text-[11px] text-text-secondary"
                title={a.path ?? a.command}
              >
                {agentLine(a)}
              </div>
            ))}
            {!busy && (scan?.agents?.length ?? 0) === 0 ? (
              <div className="rounded-xl border border-border bg-bg-tertiary px-3 py-2 text-xs text-text-secondary">
                No scan results.
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-bg-secondary p-4">
          <div className="text-sm font-semibold">Orchestrators</div>
          <div className="mt-2 text-xs text-text-secondary">
            Optional integrations; you can configure these later in Settings.
          </div>

          <div className="mt-4 space-y-2">
            <div className="rounded-xl border border-border bg-bg-tertiary px-3 py-2 font-mono text-[11px] text-text-secondary">
              {scan?.gtFound ? "✅ gt  found" : "❌ gt  not found"}
              {scan?.gtPath ? <span className="ml-2 opacity-80">({scan.gtPath})</span> : null}
            </div>
            <div className="rounded-xl border border-border bg-bg-tertiary px-3 py-2 font-mono text-[11px] text-text-secondary">
              {scan?.gastownWorkspaceFound ? "✅ workspace  found" : "❌ workspace  not found"}{" "}
              <span className="opacity-80">({scan?.gastownWorkspacePath ?? "~/gt/"})</span>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-xs text-text-secondary">
            If a mode is unavailable, Synk will gray it out with an install hint. Manual mode is always available.
          </div>
        </div>
      </div>
    </div>
  );
}
