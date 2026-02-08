import { useCallback, useEffect, useMemo, useState } from "react";

import {
  gitBranches,
  gitCreateWorktree,
  mcpDiscover,
  projectSessionConfigGet,
  projectSessionConfigSet,
  skillsDiscover,
} from "../../lib/tauri-api";
import type { AgentType, McpServerInfo, SessionConfigDisk, SessionInfo, SkillInfo } from "../../lib/types";
import { useAppStore } from "../../lib/store";

type SessionConfigProps = {
  tauriAvailable: boolean;
  projectPath: string | null;
  session: SessionInfo | null;
  open: boolean;
  onClose: () => void;
  onRefreshSessions: () => void;
};

const AGENTS: { id: AgentType; label: string }[] = [
  { id: "claude_code", label: "Claude Code" },
  { id: "gemini_cli", label: "Gemini CLI" },
  { id: "codex", label: "OpenAI Codex" },
  { id: "terminal", label: "Terminal" },
];

function uniqSorted(xs: string[]): string[] {
  return Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b));
}

function checkboxList(names: string[], selected: string[]): { name: string; checked: boolean }[] {
  const sel = new Set(selected);
  return names.map((n) => ({ name: n, checked: sel.has(n) }));
}

export function SessionConfig(props: SessionConfigProps) {
  const { tauriAvailable, projectPath, session, open, onClose, onRefreshSessions } = props;

  // Use paneIndex as the stable per-session key (sessionId is ephemeral across restarts).
  const sessionKey = session ? session.paneIndex : null;
  const storedCfg = useAppStore((s) => (sessionKey != null ? s.sessionConfigs[sessionKey] : undefined));
  const setSessionConfig = useAppStore((s) => s.setSessionConfig);

  const [localCfg, setLocalCfg] = useState<SessionConfigDisk | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [baseBranch, setBaseBranch] = useState<string>("");
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeStatus, setWorktreeStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const configuredMcpNames = useMemo(
    () => uniqSorted(mcpServers.filter((s) => s.configured).map((s) => s.name)),
    [mcpServers],
  );
  const skillNames = useMemo(() => uniqSorted(skills.map((s) => s.name)), [skills]);

  const refreshSources = useCallback(async () => {
    if (!tauriAvailable || !projectPath) return;
    const [s, m] = await Promise.all([skillsDiscover(projectPath), mcpDiscover(projectPath)]);
    setSkills(s.installed);
    setMcpServers(m.servers);
  }, [tauriAvailable, projectPath]);

  const refreshBranches = useCallback(async () => {
    if (!tauriAvailable || !projectPath) return;
    try {
      const list = await gitBranches(projectPath);
      setBranches(list);
    } catch {
      setBranches([]);
    }
  }, [tauriAvailable, projectPath]);

  // Load discovery lists when opening the panel.
  useEffect(() => {
    if (!open) return;
    refreshSources().catch(() => {});
    refreshBranches().catch(() => {});
  }, [open, refreshSources, refreshBranches]);

  // Pick a sensible default base branch once we have local branches.
  useEffect(() => {
    if (!open) return;
    if (!branches.length) return;
    if (baseBranch && branches.includes(baseBranch)) return;
    if (branches.includes("main")) {
      setBaseBranch("main");
    } else if (branches.includes("master")) {
      setBaseBranch("master");
    } else {
      setBaseBranch(branches[0] ?? "");
    }
  }, [open, branches.join("|")]);

  // Load saved session config (from store first, then from disk).
  useEffect(() => {
    if (!open || !tauriAvailable || !projectPath || !session) return;

    setError(null);
    setStatus(null);
    setWorktreeStatus(null);

    if (storedCfg) {
      setLocalCfg(storedCfg);
      return;
    }

    projectSessionConfigGet(projectPath, session.paneIndex)
      .then((cfg) => {
        if (cfg) {
          setSessionConfig(session.paneIndex, cfg);
          setLocalCfg(cfg);
        } else {
          setLocalCfg(null);
        }
      })
      .catch((e) => setError(String(e)));
  }, [open, tauriAvailable, projectPath, session?.paneIndex, storedCfg, setSessionConfig]);

  // Compute a default config if none exists yet.
  const effectiveCfg: SessionConfigDisk | null = useMemo(() => {
    if (!session) return null;
    if (localCfg) {
      return {
        ...localCfg,
        skills: localCfg.skills ?? [],
        mcpServers: localCfg.mcpServers ?? [],
      };
    }

    const defaultSkills = skills.filter((s) => s.enabled).map((s) => s.name);
    const defaultMcp = mcpServers.filter((s) => s.enabled && s.configured).map((s) => s.name);

    return {
      agentType: session.agentType,
      branch: session.branch ?? null,
      worktreeIsolation: false,
      skills: uniqSorted(defaultSkills),
      mcpServers: uniqSorted(defaultMcp),
    };
  }, [session, localCfg, skills, mcpServers]);

  const persist = useCallback(
    async (next: SessionConfigDisk) => {
      if (!tauriAvailable || !projectPath || !session) return;
      const normalized: SessionConfigDisk = {
        ...next,
        branch: next.branch && next.branch.trim() ? next.branch.trim() : null,
        skills: uniqSorted(next.skills ?? []),
        mcpServers: uniqSorted(next.mcpServers ?? []),
      };
      setSaving(true);
      setError(null);
      setStatus("Saving…");
      try {
        await projectSessionConfigSet(projectPath, session.paneIndex, normalized);
        setSessionConfig(session.paneIndex, normalized);
        setStatus("Saved");
        window.setTimeout(() => setStatus(null), 1200);
      } catch (e) {
        setError(String(e));
        setStatus(null);
      } finally {
        setSaving(false);
      }
    },
    [tauriAvailable, projectPath, session?.paneIndex, setSessionConfig],
  );

  if (!open) return null;

  return (
    <div className="h-full">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold tracking-wide text-text-primary">SESSION CONFIG</div>
          <div className="truncate font-mono text-[10px] text-text-secondary">
            {session ? `Slot #${session.paneIndex + 1} · sessionId ${session.sessionId}` : "No session selected"}
          </div>
        </div>
        <button
          className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
          onClick={onClose}
          type="button"
          title="Close"
        >
          ×
        </button>
      </div>

      {!session ? (
        <div className="p-3 text-xs text-text-secondary">Select a session to edit configuration.</div>
      ) : null}

      {session ? (
        <div className="h-[calc(100%-42px)] overflow-auto px-3 py-3">
          <div className="rounded-xl border border-border bg-bg-secondary p-2">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">APPLIES ON RESTART</div>
            <div className="mt-1 text-[11px] text-text-secondary">
              These settings are persisted to <span className="font-mono">.synk/config.json</span>.
            </div>
          </div>

          {error ? (
            <div className="mt-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-2 py-2 text-[11px] text-accent-red">
              {error}
            </div>
          ) : null}

          <div className="mt-3 rounded-xl border border-border bg-bg-secondary p-2">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">AGENT</div>
            <select
              className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary disabled:opacity-60"
              value={effectiveCfg?.agentType ?? session.agentType}
              disabled={!tauriAvailable || saving}
              onChange={(e) => {
                const next = { ...(effectiveCfg as SessionConfigDisk), agentType: e.target.value as AgentType };
                setLocalCfg(next);
                persist(next).catch(() => {});
              }}
            >
              {AGENTS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-2 rounded-xl border border-border bg-bg-secondary p-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">BRANCH</div>
                <div className="mt-0.5 text-[11px] text-text-secondary">
                  Create a worktree for this session and switch it to the new branch.
                </div>
              </div>
            </div>
            <div className="mt-1 grid grid-cols-1 gap-2">
              <input
                className="h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary disabled:opacity-60"
                placeholder="feat/phase-4-ui"
                value={effectiveCfg?.branch ?? ""}
                disabled={!tauriAvailable || saving || worktreeBusy}
                onChange={(e) => {
                  const next = { ...(effectiveCfg as SessionConfigDisk), branch: e.target.value };
                  setLocalCfg(next);
                }}
                onBlur={() => {
                  if (!effectiveCfg) return;
                  persist(effectiveCfg).catch(() => {});
                }}
              />

              <div className="flex items-center gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] font-semibold text-text-secondary">
                  Base
                  {branches.length ? (
                    <select
                      className="h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 font-mono text-[12px] text-text-primary disabled:opacity-60"
                      value={baseBranch}
                      disabled={!tauriAvailable || saving || worktreeBusy}
                      onChange={(e) => setBaseBranch(e.target.value)}
                    >
                      {branches.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 font-mono text-[12px] text-text-primary disabled:opacity-60"
                      value={baseBranch}
                      disabled={!tauriAvailable || saving || worktreeBusy}
                      placeholder="main"
                      onChange={(e) => setBaseBranch(e.target.value)}
                    />
                  )}
                </label>

                <button
                  type="button"
                  className="h-9 shrink-0 rounded-lg border border-accent-blue/45 bg-accent-blue/10 px-3 text-[11px] font-semibold text-accent-blue hover:bg-accent-blue/15 disabled:opacity-60"
                  disabled={
                    !tauriAvailable ||
                    saving ||
                    worktreeBusy ||
                    !session ||
                    !(effectiveCfg?.branch && effectiveCfg.branch.trim()) ||
                    !(baseBranch && baseBranch.trim())
                  }
                  title="Create branch (if needed), add a worktree, and switch this session into it"
                  onClick={async () => {
                    if (!tauriAvailable || !projectPath || !session) return;
                    const branch = (effectiveCfg?.branch ?? "").trim();
                    const base = (baseBranch ?? "").trim();
                    if (!branch || !base) return;

                    setError(null);
                    setWorktreeStatus("Creating worktree…");
                    setWorktreeBusy(true);
                    try {
                      await gitCreateWorktree(session.sessionId, branch, base);
                      setWorktreeStatus("Switched session to worktree");

                      // Refresh session list so the UI reflects the live branch/workingDir.
                      onRefreshSessions();

                      // Persist this as the session's preferred branch for restarts.
                      const next = { ...(effectiveCfg as SessionConfigDisk), branch };
                      setLocalCfg(next);
                      persist(next).catch(() => {});
                    } catch (e) {
                      setError(String(e));
                      setWorktreeStatus(null);
                    } finally {
                      setWorktreeBusy(false);
                      window.setTimeout(() => setWorktreeStatus(null), 1600);
                    }
                  }}
                >
                  Create worktree
                </button>
              </div>

              {worktreeStatus ? (
                <div className="text-[11px] text-text-secondary/80">{worktreeStatus}</div>
              ) : (
                <div className="text-[11px] text-text-secondary/70">
                  Tip: use <span className="font-mono">feat/phase-4</span> (or similar) while you implement Phase 4.
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-border bg-bg-secondary p-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">WORKTREE ISOLATION</div>
                <div className="mt-0.5 text-[11px] text-text-secondary">Persisted toggle (execution later).</div>
              </div>
              <input
                type="checkbox"
                checked={!!effectiveCfg?.worktreeIsolation}
                disabled={!tauriAvailable || saving}
                onChange={(e) => {
                  const next = { ...(effectiveCfg as SessionConfigDisk), worktreeIsolation: e.target.checked };
                  setLocalCfg(next);
                  persist(next).catch(() => {});
                }}
                aria-label="Worktree isolation"
              />
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-border bg-bg-secondary p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">SKILLS</div>
              <div className="font-mono text-[10px] text-text-secondary">
                {(effectiveCfg?.skills?.length ?? 0)}/{skillNames.length}
              </div>
            </div>
            <div className="mt-2 space-y-1">
              {skillNames.length === 0 ? (
                <div className="text-[11px] text-text-secondary">No skills detected.</div>
              ) : (
                checkboxList(skillNames, effectiveCfg?.skills ?? []).map((row) => (
                  <label
                    key={row.name}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-bg-tertiary px-2 py-2 text-xs hover:bg-bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <input
                      type="checkbox"
                      checked={row.checked}
                      disabled={!tauriAvailable || saving}
                      onChange={(e) => {
                        const prev = effectiveCfg?.skills ?? [];
                        const nextSkills = e.target.checked
                          ? uniqSorted([...prev, row.name])
                          : prev.filter((x) => x !== row.name);
                        const next = { ...(effectiveCfg as SessionConfigDisk), skills: nextSkills };
                        setLocalCfg(next);
                        persist(next).catch(() => {});
                      }}
                      aria-label={`Enable skill ${row.name} for this session`}
                    />
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-border bg-bg-secondary p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">MCP SERVERS</div>
              <div className="font-mono text-[10px] text-text-secondary">
                {(effectiveCfg?.mcpServers?.length ?? 0)}/{configuredMcpNames.length}
              </div>
            </div>
            <div className="mt-2 space-y-1">
              {configuredMcpNames.length === 0 ? (
                <div className="text-[11px] text-text-secondary">No configured MCP servers detected.</div>
              ) : (
                checkboxList(configuredMcpNames, effectiveCfg?.mcpServers ?? []).map((row) => (
                  <label
                    key={row.name}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-lg border border-border bg-bg-tertiary px-2 py-2 text-xs hover:bg-bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <input
                      type="checkbox"
                      checked={row.checked}
                      disabled={!tauriAvailable || saving}
                      onChange={(e) => {
                        const prev = effectiveCfg?.mcpServers ?? [];
                        const nextMcp = e.target.checked
                          ? uniqSorted([...prev, row.name])
                          : prev.filter((x) => x !== row.name);
                        const next = { ...(effectiveCfg as SessionConfigDisk), mcpServers: nextMcp };
                        setLocalCfg(next);
                        persist(next).catch(() => {});
                      }}
                      aria-label={`Enable MCP server ${row.name} for this session`}
                    />
                  </label>
                ))
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-[11px] text-text-secondary">
              {status ? <span className="font-mono">{status}</span> : null}
            </div>
            <button
              className="rounded-lg border border-border bg-bg-tertiary px-2.5 py-2 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60"
              disabled={!tauriAvailable || saving}
              onClick={() => refreshSources().catch(() => {})}
              type="button"
              title="Refresh skills/MCP lists"
            >
              Refresh Lists
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
