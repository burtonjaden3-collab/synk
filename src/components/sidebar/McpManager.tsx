import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { defaultAppSettings } from "../../lib/default-settings";
import { useAppStore } from "../../lib/store";
import { mcpDiscoverForAgent, mcpSetEnabledForAgent } from "../../lib/tauri-api";
import type { AgentType, McpDiscoveryResult, McpServerInfo, McpServerStatus } from "../../lib/types";

type McpManagerProps = {
  tauriAvailable: boolean;
  projectPath: string | null;
  agentType: AgentType;
  title: string;
  allowToggle?: boolean;
};

function displayStatus(s: McpServerInfo): McpServerStatus | "ready" {
  // Claude/Codex/OpenRouter often launch MCP servers on demand. Enabled + configured + not currently
  // running means "ready", not a hard failure.
  if (s.configured && s.enabled && !s.running && s.status === "disconnected") {
    return "ready";
  }
  return s.status;
}

function statusEmoji(status: McpServerStatus | "ready"): string {
  switch (status) {
    case "ready":
      return "🔵";
    case "connected":
      return "🟢";
    case "starting":
      return "🟡";
    case "disconnected":
      return "🔴";
    case "disabled":
      return "⚪";
  }
}

function subtitleFor(s: McpServerInfo): string {
  const bits: string[] = [];
  if (s.command) bits.push(s.command);
  if (s.running && s.pid) bits.push(`pid ${s.pid}`);
  if (s.source) bits.push(s.source);
  return bits.join(" · ");
}

const DEFAULT_DISCOVERY_POLL_MS = Math.max(2000, defaultAppSettings().performance.pollIntervalMs);

export function McpManager(props: McpManagerProps) {
  const { tauriAvailable, projectPath, agentType, title, allowToggle } = props;

  const [data, setData] = useState<McpDiscoveryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inFlightRef = useRef(false);
  const settingsPollMs = useAppStore((s) => s.settings?.performance.pollIntervalMs ?? DEFAULT_DISCOVERY_POLL_MS);
  const refreshIntervalMs = Math.max(2000, settingsPollMs);
  const reactId = useId();

  const refresh = useCallback(async (background = false) => {
    if (!tauriAvailable) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!background) {
      setError(null);
      setLoading(true);
    }
    try {
      const next = await mcpDiscoverForAgent(projectPath, agentType);
      setData(next);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      if (!background) {
        setLoading(false);
      }
      inFlightRef.current = false;
    }
  }, [tauriAvailable, projectPath, agentType]);

  useEffect(() => {
    if (!tauriAvailable) return;

    const tick = () => {
      refresh(true).catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };

    tick();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") tick();
    }, refreshIntervalMs);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [tauriAvailable, refresh, refreshIntervalMs]);

  // Match Skills behavior: collapse MCP sections when switching/loading projects.
  useEffect(() => {
    setOpen(false);
  }, [projectPath, agentType]);

  const servers = data?.servers ?? [];
  const configured = useMemo(() => servers.filter((s) => s.configured), [servers]);
  const processesOnly = useMemo(() => servers.filter((s) => !s.configured), [servers]);
  const enabledCount = useMemo(() => configured.filter((s) => s.enabled).length, [configured]);
  const panelId = `mcp-panel-${agentType}-${reactId}`;

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-2">
      <div className="flex items-center gap-2">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-bg-hover"
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          title="Collapse/expand"
        >
          <div className="font-mono text-[11px] text-text-secondary">{open ? "▾" : "▸"}</div>
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold text-text-primary">{title}</div>
            <div className="truncate font-mono text-[10px] text-text-secondary">
              {configured.length > 0 ? (
                <span>
                  {enabledCount}/{configured.length} enabled
                </span>
              ) : (
                <span className="text-text-secondary">not detected</span>
              )}
              {processesOnly.length > 0 ? (
                <>
                  <span className="mx-1 text-border">·</span>
                  <span>{processesOnly.length} running</span>
                </>
              ) : null}
            </div>
          </div>
        </button>

        <button
          className="rounded-lg border border-border bg-bg-tertiary px-2.5 py-2 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60"
          disabled={!tauriAvailable || loading}
          onClick={() => refresh(false).catch(() => {})}
          type="button"
          title="Re-scan MCP servers"
        >
          Refresh
        </button>
      </div>

      <div
        id={panelId}
        className={[
          "mt-2 grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        ].join(" ")}
        aria-hidden={!open}
      >
        <div className={["min-h-0 overflow-hidden", open ? "pointer-events-auto" : "pointer-events-none"].join(" ")}>
          <div className="truncate font-mono text-[10px] text-text-secondary">
            {data?.projectConfigPath ? (
              <>
                <span>{data.projectConfigPath}</span>
                <span className="mx-1 text-border">·</span>
                <span>{data.globalConfigPath}</span>
              </>
            ) : (
              <span>{data?.globalConfigPath ?? "(unknown)"}</span>
            )}
          </div>

          {error ? (
            <div className="mt-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-2 py-2 text-[11px] text-accent-red">
              {error}
            </div>
          ) : null}

          {!tauriAvailable ? (
            <div className="mt-2 text-[11px] text-text-secondary">
              Disabled in browser preview mode.
            </div>
          ) : null}

          <div className="mt-2 space-y-1">
            {configured.length === 0 ? (
              <div className="rounded-lg border border-border bg-bg-tertiary px-2 py-2 text-[11px] text-text-secondary">
                <div className="text-text-primary">No configured MCP servers detected.</div>
                <div className="mt-1">
                  Synk discovers MCP servers for <span className="font-mono">{agentType}</span> via its config,
                  plus any running <span className="font-mono">mcp-server*</span> processes.
                </div>
                {agentType === "claude_code" ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer select-none font-mono text-[10px] text-text-secondary">
                      example config
                    </summary>
                    <pre className="mt-2 overflow-auto rounded-md border border-border bg-bg-secondary p-2 font-mono text-[10px] text-text-secondary">
{`{
  "servers": {
    "filesystem": {
      "command": "mcp-server-filesystem",
      "args": ["/home/jaden-burton/projects"],
      "env": {},
      "enabled": true
    }
  }
}`}
                    </pre>
                  </details>
                ) : null}
              </div>
            ) : (
              configured.map((s) => {
                const canToggle = (allowToggle ?? true) && tauriAvailable && !loading && s.source !== "process";
                const scope = s.source === "project" ? "project" : "global";
                const shownStatus = displayStatus(s);
                return (
                  <label
                    key={s.name}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-bg-tertiary px-2 py-2 text-left hover:bg-bg-hover"
                    title={s.cmdline ?? s.command ?? s.name}
                  >
                    <input
                      className="mt-0.5"
                      type="checkbox"
                      checked={s.enabled}
                      disabled={!canToggle}
                      onChange={async (e) => {
                        const nextEnabled = e.target.checked;
                        setData((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            servers: prev.servers.map((x) =>
                              x.name === s.name ? { ...x, enabled: nextEnabled } : x,
                            ),
                          };
                        });
                        try {
                          await mcpSetEnabledForAgent(agentType, s.name, nextEnabled, projectPath, scope);
                          refresh(false).catch(() => {});
                        } catch (err) {
                          setError(String(err));
                          refresh(false).catch(() => {});
                        }
                      }}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-mono text-[11px]">{statusEmoji(shownStatus)}</div>
                        <div className="truncate text-xs font-semibold text-text-primary">{s.name}</div>
                        <div className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                          {shownStatus}
                        </div>
                      </div>
                      {subtitleFor(s) ? (
                        <div className="mt-0.5 truncate font-mono text-[10px] text-text-secondary">
                          {subtitleFor(s)}
                        </div>
                      ) : null}
                    </div>
                  </label>
                );
              })
            )}
          </div>

          {processesOnly.length > 0 ? (
            <div className="mt-3">
              <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                RUNNING (UNCONFIGURED)
              </div>
              <div className="mt-1 space-y-1">
                {processesOnly.map((p) => (
                  <div
                    key={p.name}
                    className="rounded-lg border border-border bg-bg-tertiary px-2 py-2 text-[11px] text-text-secondary"
                    title={p.cmdline ?? ""}
                  >
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-[11px]">{statusEmoji(p.status)}</div>
                      <div className="min-w-0 flex-1 truncate font-mono">{p.name}</div>
                    </div>
                    {p.cmdline ? (
                      <div className="mt-1 truncate font-mono text-[10px]">{p.cmdline}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
