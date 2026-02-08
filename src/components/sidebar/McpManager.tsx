import { useCallback, useEffect, useMemo, useState } from "react";

import { mcpDiscoverForAgent, mcpSetEnabledForAgent } from "../../lib/tauri-api";
import type { AgentType, McpDiscoveryResult, McpServerInfo, McpServerStatus } from "../../lib/types";

type McpManagerProps = {
  tauriAvailable: boolean;
  projectPath: string | null;
  agentType: AgentType;
  title: string;
  allowToggle?: boolean;
};

function statusEmoji(status: McpServerStatus): string {
  switch (status) {
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

export function McpManager(props: McpManagerProps) {
  const { tauriAvailable, projectPath, agentType, title, allowToggle } = props;

  const [data, setData] = useState<McpDiscoveryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!tauriAvailable) return;
    setError(null);
    setLoading(true);
    try {
      const next = await mcpDiscoverForAgent(projectPath, agentType);
      setData(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [tauriAvailable, projectPath]);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const servers = data?.servers ?? [];
  const configured = useMemo(() => servers.filter((s) => s.configured), [servers]);
  const processesOnly = useMemo(() => servers.filter((s) => !s.configured), [servers]);

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-text-primary">{title}</div>
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
        </div>

        <button
          className="rounded-lg border border-border bg-bg-tertiary px-2.5 py-2 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60"
          disabled={!tauriAvailable || loading}
          onClick={() => refresh().catch(() => {})}
          type="button"
          title="Re-scan MCP servers"
        >
          Refresh
        </button>
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
                      refresh().catch(() => {});
                    } catch (err) {
                      setError(String(err));
                      refresh().catch(() => {});
                    }
                  }}
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="font-mono text-[11px]">{statusEmoji(s.status)}</div>
                    <div className="truncate text-xs font-semibold text-text-primary">{s.name}</div>
                    <div className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                      {s.status}
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
  );
}
