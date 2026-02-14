import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { defaultAppSettings } from "../../lib/default-settings";
import { useAppStore } from "../../lib/store";
import { skillsDiscoverForAgent, skillsSetEnabledForAgent } from "../../lib/tauri-api";
import type { AgentType, SkillInfo, SkillsDiscoveryResult } from "../../lib/types";

type SkillsBrowserProps = {
  tauriAvailable: boolean;
  projectPath: string | null;
  agentType: AgentType;
  title: string;
};

function descFor(skill: SkillInfo): string {
  const bits: string[] = [];
  if (skill.description) bits.push(skill.description);
  if (!skill.exists) bits.push("missing on disk");
  return bits.join(" · ");
}

const DEFAULT_DISCOVERY_POLL_MS = Math.max(2000, defaultAppSettings().performance.pollIntervalMs);

export function SkillsBrowser(props: SkillsBrowserProps) {
  const { tauriAvailable, projectPath, agentType, title } = props;

  const [data, setData] = useState<SkillsDiscoveryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const inFlightRef = useRef(false);
  const settingsPollMs = useAppStore((s) => s.settings?.performance.pollIntervalMs ?? DEFAULT_DISCOVERY_POLL_MS);
  const refreshIntervalMs = Math.max(2000, settingsPollMs);
  const reactId = useId();
  const panelId = `skills-panel-${agentType}-${reactId}`;

  const refresh = useCallback(async (background = false) => {
    if (!tauriAvailable) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!background) {
      setError(null);
      setLoading(true);
    }
    try {
      const next = await skillsDiscoverForAgent(projectPath, agentType);
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

  useEffect(() => {
    setOpen(false);
  }, [projectPath, agentType]);

  const installed = data?.installed ?? [];
  const recommended = data?.recommended ?? [];

  const recommendedSet = useMemo(() => new Set(recommended), [recommended]);
  const enabledCount = useMemo(() => installed.filter((s) => s.enabled).length, [installed]);

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
              {installed.length > 0 ? (
                <span>
                  {enabledCount}/{installed.length} enabled
                </span>
              ) : (
                <span className="text-text-secondary">not detected</span>
              )}
              {recommended.length > 0 ? (
                <>
                  <span className="mx-1 text-border">·</span>
                  <span>{recommended.length} project</span>
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
          title="Re-scan skills"
        >
          {loading ? "..." : "Refresh"}
        </button>
      </div>

      <div
        id={panelId}
        className={[
          // Avoid fixed max-height caps (they break long lists); animate using grid row sizing instead.
          "mt-2 grid transition-[grid-template-rows,opacity] duration-200 ease-out",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        ].join(" ")}
        aria-hidden={!open}
      >
        <div className={["min-h-0 overflow-hidden", open ? "pointer-events-auto" : "pointer-events-none"].join(" ")}>
          {error ? (
            <div className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-2 py-2 text-[11px] text-accent-red">
              {error}
            </div>
          ) : null}

          {!tauriAvailable ? (
            <div className="mt-2 text-[11px] text-text-secondary">Disabled in browser preview mode.</div>
          ) : null}

          <div className="mt-2 space-y-1">
            {installed.length === 0 ? (
              <div className="rounded-lg border border-border bg-bg-tertiary px-2 py-2 text-[11px] text-text-secondary">
                No skills detected for <span className="font-mono">{agentType}</span>.
              </div>
            ) : (
              installed.map((s) => (
                <label
                  key={`${s.name}:${s.path}`}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-border bg-bg-tertiary px-2 py-2 text-left hover:bg-bg-hover"
                  title={s.path}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="truncate text-xs font-semibold text-text-primary">{s.name}</div>
                      {recommendedSet.has(s.name) ? (
                        <div className="rounded-md border border-accent-blue/40 bg-accent-blue/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent-blue">
                          project
                        </div>
                      ) : null}
                      {s.source === "directory" ? (
                        <div className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-text-secondary">
                          local
                        </div>
                      ) : null}
                      {!s.exists ? (
                        <div className="rounded-md border border-accent-red/40 bg-accent-red/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-red">
                          missing
                        </div>
                      ) : null}
                    </div>
                    {descFor(s) ? (
                      <div className="mt-0.5 text-[11px] text-text-secondary">{descFor(s)}</div>
                    ) : null}
                  </div>

                  <input
                    className="mt-0.5"
                    type="checkbox"
                    checked={s.enabled}
                    disabled={!tauriAvailable || loading}
                    onChange={async (e) => {
                      const nextEnabled = e.target.checked;
                      setData((prev) => {
                        if (!prev) return prev;
                        return {
                          ...prev,
                          installed: prev.installed.map((x) =>
                            x.path === s.path ? { ...x, enabled: nextEnabled } : x,
                          ),
                        };
                      });
                      try {
                        await skillsSetEnabledForAgent(agentType, s.name, nextEnabled, s.path, s.description ?? null);
                      } catch (err) {
                        setError(String(err));
                        refresh(false).catch(() => {});
                      }
                    }}
                    aria-label={`Enable ${s.name}`}
                  />
                </label>
              ))
            )}
          </div>

          {recommended.length > 0 ? (
            <details className="mt-3 rounded-lg border border-border bg-bg-tertiary px-2 py-2">
              <summary className="cursor-pointer select-none text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                PROJECT RECOMMENDED
              </summary>
              <div className="mt-2 flex flex-wrap gap-1">
                {recommended.map((name) => (
                  <div
                    key={name}
                    className="rounded-md border border-border bg-bg-secondary px-2 py-1 font-mono text-[10px] text-text-secondary"
                  >
                    {name}
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          <div className="mt-2 truncate font-mono text-[10px] text-text-secondary" title={data?.settingsPath ?? ""}>
            Config: {data?.settingsPath ?? "(unknown)"}
          </div>
        </div>
      </div>
    </div>
  );
}
