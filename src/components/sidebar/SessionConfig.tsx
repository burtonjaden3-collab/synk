import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  gitBranches,
  gitCreateWorktree,
  gitEnsureWorktree,
  gitListWorktrees,
  gitRemoveWorktree,
  mcpDiscoverForAgent,
  projectSessionConfigGet,
  projectSessionConfigSet,
  sessionCd,
  sessionRestart,
  skillsDiscoverForAgent,
} from "../../lib/tauri-api";
import type {
  AgentType,
  CodexProvider,
  McpServerInfo,
  SessionConfigDisk,
  SessionInfo,
  SkillInfo,
  WorktreeInfo,
} from "../../lib/types";
import { useAppStore } from "../../lib/store";
import { defaultAppSettings } from "../../lib/default-settings";
import { McpManager } from "./McpManager";
import { MCP_AGENT_TABS } from "./mcp-agent-tabs";
import { SKILL_AGENT_TABS } from "./skill-agent-tabs";
import { SkillsBrowser } from "./SkillsBrowser";

type SessionConfigProps = {
  tauriAvailable: boolean;
  projectPath: string | null;
  session: SessionInfo | null;
  open: boolean;
  onClose: () => void;
  onRefreshSessions: () => void;
};
type WorktreesView = "switch" | "destination" | "manage";

const AGENTS: { id: AgentType; label: string }[] = [
  { id: "claude_code", label: "Claude Code" },
  { id: "gemini_cli", label: "Gemini CLI" },
  { id: "codex", label: "OpenAI Codex" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "terminal", label: "Terminal" },
];

function agentLabel(t: AgentType): string {
  return AGENTS.find((a) => a.id === t)?.label ?? t;
}

function agentSupportsSkills(t: AgentType): boolean {
  return t === "claude_code" || t === "codex" || t === "openrouter";
}

function agentSupportsMcp(t: AgentType): boolean {
  return t === "claude_code" || t === "codex" || t === "openrouter";
}

function uniqSorted(xs: string[]): string[] {
  return Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b));
}

const DEFAULT_DISCOVERY_POLL_MS = Math.max(2000, defaultAppSettings().performance.pollIntervalMs);
const QUICK_SWITCH_ROOT = "__synk_root__";
const WORKTREES_VIEWS: { id: WorktreesView; label: string; hint: string }[] = [
  { id: "switch", label: "Switch", hint: "Move this pane now" },
  { id: "destination", label: "Destination", hint: "Set branch target" },
  { id: "manage", label: "Manage", hint: "Review and delete" },
];

function worktreeDisplayName(w: WorktreeInfo): string {
  if (w.branch) return w.branch;
  if (w.detached) return "(detached)";
  return "(unknown)";
}

function readablePath(path: string, projectPath: string | null): string {
  const p = (path ?? "").trim();
  if (!p) return "(unknown)";

  const root = (projectPath ?? "").replace(/\/+$/, "");
  if (root && (p === root || p.startsWith(`${root}/`))) {
    const rest = p.slice(root.length).replace(/^\/+/, "");
    return rest ? `./${rest}` : ".";
  }

  const synkWorktreeMarker = "/.synk/worktrees/";
  const markerIdx = p.indexOf(synkWorktreeMarker);
  if (markerIdx >= 0) return p.slice(markerIdx + 1);

  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 5) return p;
  return `.../${parts.slice(-5).join("/")}`;
}

function normalizePathForMatch(path: string | null | undefined): string {
  const p = (path ?? "").trim();
  if (!p) return "";
  if (p === "/") return p;
  return p.replace(/\/+$/, "");
}

export function SessionConfig(props: SessionConfigProps) {
  const { tauriAvailable, projectPath, session, open, onClose, onRefreshSessions } = props;

  // Use paneIndex as the stable per-session key (sessionId is ephemeral across restarts).
  const sessionKey = session ? session.paneIndex : null;
  const storedCfg = useAppStore((s) => (sessionKey != null ? s.sessionConfigs[sessionKey] : undefined));
  const setSessionConfig = useAppStore((s) => s.setSessionConfig);
  const settings = useAppStore((s) => s.settings);

  const [localCfg, setLocalCfg] = useState<SessionConfigDisk | null>(null);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServerInfo[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [baseBranch, setBaseBranch] = useState<string>("");
  const [worktreeBusy, setWorktreeBusy] = useState(false);
  const [worktreeStatus, setWorktreeStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourcesBusy, setSourcesBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState<string>("Confirm");
  const [confirmBody, setConfirmBody] = useState<string>("");
  const [confirmCta, setConfirmCta] = useState<string>("Yes");
  const [confirmTone, setConfirmTone] = useState<"blue" | "red">("blue");
  const [quickSwitchValue, setQuickSwitchValue] = useState<string>(QUICK_SWITCH_ROOT);
  const [worktreesView, setWorktreesView] = useState<WorktreesView>("switch");
  const [skillsAgentTab, setSkillsAgentTab] = useState<AgentType>("claude_code");
  const [mcpAgentTab, setMcpAgentTab] = useState<AgentType>("claude_code");
  const confirmActionRef = useRef<null | (() => Promise<void>)>(null);
  const sourcesInFlightRef = useRef(false);

  const branchPrefix = (settings?.git?.branchPrefix ?? "feat/").trim();
  const settingsPollMs = settings?.performance.pollIntervalMs ?? DEFAULT_DISCOVERY_POLL_MS;
  const refreshIntervalMs = Math.max(2000, settingsPollMs);

  const normalizeDestinationBranch = useCallback(
    (raw: string): string => {
      const b = raw.trim();
      if (!b) return "";
      if (!branchPrefix) return b;
      if (b.includes("/") || b.startsWith(branchPrefix)) return b;
      return `${branchPrefix}${b}`;
    },
    [branchPrefix],
  );

  const refreshSources = useCallback(async (agentType: AgentType, background = false) => {
    if (!tauriAvailable || !projectPath) return;
    if (sourcesInFlightRef.current) return;
    sourcesInFlightRef.current = true;
    if (!background) setSourcesBusy(true);
    try {
      const [s, m] = await Promise.all([
        skillsDiscoverForAgent(projectPath, agentType),
        mcpDiscoverForAgent(projectPath, agentType),
      ]);
      setSkills(s.installed);
      setMcpServers(m.servers);
      setError(null);
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      if (!background) setSourcesBusy(false);
      sourcesInFlightRef.current = false;
    }
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

  const refreshWorktrees = useCallback(async () => {
    if (!tauriAvailable || !projectPath) return;
    try {
      const list = await gitListWorktrees(projectPath);
      setWorktrees(list);
    } catch {
      setWorktrees([]);
    }
  }, [tauriAvailable, projectPath]);

  // Load discovery lists when opening the panel.
  useEffect(() => {
    if (!open) return;
    if (!session) return;
    refreshSources(session.agentType).catch(() => {});
    refreshBranches().catch(() => {});
    refreshWorktrees().catch(() => {});
  }, [open, session?.sessionId, refreshSources, refreshBranches, refreshWorktrees]);

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

    const defaultSkills = agentSupportsSkills(session.agentType) ? skills.filter((s) => s.enabled).map((s) => s.name) : [];
    const defaultMcp = agentSupportsMcp(session.agentType)
      ? mcpServers.filter((s) => s.enabled && s.configured).map((s) => s.name)
      : [];

    return {
      agentType: session.agentType,
      branch: session.branch ?? null,
      worktreeIsolation: false,
      skills: uniqSorted(defaultSkills),
      mcpServers: uniqSorted(defaultMcp),
    };
  }, [session, localCfg, skills, mcpServers]);

  const selectedAgentType = useMemo<AgentType>(() => {
    // Agent type is not user-editable in Session Config; always reflect the live session.
    return (session?.agentType ?? "terminal") as AgentType;
  }, [session?.agentType]);
  const activeSkillsTab = useMemo(
    () => SKILL_AGENT_TABS.find((tab) => tab.id === skillsAgentTab) ?? SKILL_AGENT_TABS[0],
    [skillsAgentTab],
  );
  const activeMcpTab = useMemo(
    () => MCP_AGENT_TABS.find((tab) => tab.id === mcpAgentTab) ?? MCP_AGENT_TABS[0],
    [mcpAgentTab],
  );

  useEffect(() => {
    if (!open) return;
    if (agentSupportsSkills(selectedAgentType)) {
      setSkillsAgentTab(selectedAgentType);
      return;
    }
    setSkillsAgentTab(SKILL_AGENT_TABS[0]?.id ?? "claude_code");
  }, [open, session?.sessionId, selectedAgentType]);

  useEffect(() => {
    if (!open) return;
    if (agentSupportsMcp(selectedAgentType)) {
      setMcpAgentTab(selectedAgentType);
      return;
    }
    setMcpAgentTab(MCP_AGENT_TABS[0]?.id ?? "claude_code");
  }, [open, session?.sessionId, selectedAgentType]);

  // If the user changes the agent dropdown, re-load the provider-specific skills/MCP lists.
  useEffect(() => {
    if (!open) return;
    if (!tauriAvailable) return;
    if (!projectPath) return;
    refreshSources(selectedAgentType, true).catch(() => {});
  }, [open, tauriAvailable, projectPath, selectedAgentType, refreshSources]);

  // Keep skill/MCP lists live while the panel is open.
  useEffect(() => {
    if (!open) return;
    if (!tauriAvailable) return;
    if (!projectPath) return;

    const tick = () => {
      if (saving || sourcesBusy) return;
      refreshSources(selectedAgentType, true).catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };

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
  }, [
    open,
    tauriAvailable,
    projectPath,
    selectedAgentType,
    refreshSources,
    refreshIntervalMs,
    saving,
    sourcesBusy,
  ]);

  const persist = useCallback(
    async (next: SessionConfigDisk) => {
      if (!tauriAvailable || !projectPath || !session) return;
      const normalized: SessionConfigDisk = {
        ...next,
        agentType: next.agentType ?? session.agentType,
        branch: next.branch && next.branch.trim() ? next.branch.trim() : null,
        // Removed feature: keep persisted configs clean/stable.
        worktreeIsolation: false,
        skills: uniqSorted(next.skills ?? []),
        mcpServers: uniqSorted(next.mcpServers ?? []),
      };
      const agentType = (normalized.agentType ?? session.agentType ?? "terminal") as AgentType;
      if (!agentSupportsSkills(agentType)) normalized.skills = [];
      if (!agentSupportsMcp(agentType)) normalized.mcpServers = [];
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

  const models = useMemo(() => {
    const defaults = defaultAppSettings().aiProviders;
    const raw = (settings?.aiProviders ?? {}) as Partial<typeof defaults>;
    return {
      ...defaults,
      ...raw,
      anthropic: { ...defaults.anthropic, ...(raw.anthropic ?? {}) },
      google: { ...defaults.google, ...(raw.google ?? {}) },
      openai: { ...defaults.openai, ...(raw.openai ?? {}) },
      openrouter: { ...defaults.openrouter, ...(raw.openrouter ?? {}) },
      ollama: { ...defaults.ollama, ...(raw.ollama ?? {}) },
    };
  }, [settings?.aiProviders]);
  const modelForAgent = useCallback(
    (t: AgentType): string | null => {
      switch (t) {
        case "claude_code":
          return models.anthropic.defaultModel || null;
        case "gemini_cli":
          return models.google.defaultModel || null;
        case "codex":
          return models.openai.defaultModel || null;
        case "openrouter":
          return models.openrouter.defaultModel || null;
        case "terminal":
        default:
          return null;
      }
    },
    [models],
  );
  const modelForSession = useCallback(
    (s: SessionInfo): string | null => {
      const liveModel = (s.model ?? "").trim();
      if (liveModel) return liveModel;
      return modelForAgent(s.agentType);
    },
    [modelForAgent],
  );
  const codexProviderForSession = useCallback((s: SessionInfo): CodexProvider | null => {
    if (s.agentType === "openrouter") return "openrouter";
    if (s.agentType !== "codex") return null;
    return s.codexProvider ?? null;
  }, []);
  const switchSessionLocation = useCallback(
    async (dir: string, branch: string | null) => {
      if (!session) return;
      const targetDir = dir.trim();
      if (!targetDir) throw new Error("target dir is empty");

      if (session.agentType === "terminal") {
        await sessionCd(session.sessionId, targetDir, branch);
        return;
      }

      await sessionRestart(
        session.sessionId,
        targetDir,
        branch,
        modelForSession(session),
        codexProviderForSession(session),
      );
    },
    [session, modelForSession, codexProviderForSession],
  );

  const switchPaneNow = useCallback(
    async (rawBranch: string) => {
      if (!tauriAvailable || !projectPath || !session || !effectiveCfg) return;

      const branch = normalizeDestinationBranch(rawBranch);
      const wantsRoot = !branch;
      const isTerminal = session.agentType === "terminal";

      setError(null);
      setWorktreeBusy(true);
      setWorktreeStatus(wantsRoot ? "Switching to root…" : "Opening worktree…");
      try {
        if (wantsRoot) {
          await switchSessionLocation(projectPath, null);
          onRefreshSessions();

          const next: SessionConfigDisk = { ...(effectiveCfg as SessionConfigDisk), branch: null };
          setLocalCfg(next);
          persist(next).catch(() => {});

          setWorktreeStatus("Root");
          return;
        }

        const base = (baseBranch ?? "").trim();
        if (!base) throw new Error("base branch is empty");

        let ensuredPath = "";
        let ensuredBranch: string = branch;
        if (isTerminal) {
          const resp = await gitCreateWorktree(session.sessionId, branch, base);
          ensuredPath = resp.worktreePath;
          ensuredBranch = resp.branch;
        } else {
          const resp = await gitEnsureWorktree(projectPath, branch, base);
          ensuredPath = resp.worktreePath;
          ensuredBranch = resp.branch;
          await switchSessionLocation(ensuredPath, ensuredBranch);
        }

        onRefreshSessions();
        refreshWorktrees().catch(() => {});
        setWorktreeStatus("Worktree ready");

        // Persist destination for restarts.
        const next: SessionConfigDisk = { ...(effectiveCfg as SessionConfigDisk), branch: ensuredBranch };
        setLocalCfg(next);
        persist(next).catch(() => {});
      } catch (e) {
        setError(String(e));
        setWorktreeStatus(null);
      } finally {
        setWorktreeBusy(false);
        window.setTimeout(() => setWorktreeStatus(null), 1600);
      }
    },
    [
      tauriAvailable,
      projectPath,
      session,
      effectiveCfg,
      baseBranch,
      persist,
      normalizeDestinationBranch,
      switchSessionLocation,
      onRefreshSessions,
      refreshWorktrees,
    ],
  );

  const requestSwitch = useCallback(
    (rawBranch: string, sourceLabel: string) => {
      if (!tauriAvailable || !projectPath || !session || !effectiveCfg) return;
      if (worktreeBusy || saving) return;

      const branch = normalizeDestinationBranch(rawBranch);
      const wantsRoot = !branch;

      setConfirmTitle(wantsRoot ? "Switch To Root?" : "Create/Switch Worktree?");
      setConfirmBody(
        wantsRoot
          ? `This will restart/switch this pane back to the project root.\n\nSource: ${sourceLabel}`
          : `This will create (if needed) and switch this pane to the worktree for:\n\n${branch}\n\nSource: ${sourceLabel}`,
      );
      setConfirmCta("Yes, switch");
      setConfirmTone("blue");

      confirmActionRef.current = async () => {
        await switchPaneNow(rawBranch);
      };
      setConfirmOpen(true);
    },
    [
      tauriAvailable,
      projectPath,
      session,
      effectiveCfg,
      worktreeBusy,
      saving,
      normalizeDestinationBranch,
      switchPaneNow,
    ],
  );

  const requestDeleteWorktree = useCallback(
    (w: WorktreeInfo) => {
      if (!tauriAvailable || !projectPath || !session || !effectiveCfg) return;
      if (worktreeBusy || saving) return;

      if (!w.isSynkManaged) {
        setError("This worktree wasn't created by Synk. For safety, Synk only deletes Synk-managed worktrees.");
        return;
      }
      if (!w.branch) {
        setError("Can't delete a detached worktree from the UI yet (no branch).");
        return;
      }
      if (w.locked) {
        setError("This worktree is locked. Unlock it in git before deleting.");
        return;
      }

      setConfirmTitle("Delete Worktree?");
      setConfirmBody(
        `This will remove the worktree directory and delete the branch:\n\n${w.branch}\n\nAny uncommitted changes inside that worktree will be lost.\n\nIf this pane is currently in that worktree, it will be moved back to root.`,
      );
      setConfirmCta("Yes, delete");
      setConfirmTone("red");

      confirmActionRef.current = async () => {
        setError(null);
        setWorktreeBusy(true);
        setWorktreeStatus("Deleting worktree…");
        try {
          await gitRemoveWorktree(session.sessionId, w.branch);

          // If we were inside that worktree, ensure the pane lands back at root.
          const wd = session.workingDir ?? "";
          const isCurrent = !!wd && (wd === w.path || wd.startsWith(`${w.path}/`));
          if (isCurrent) {
            await switchSessionLocation(projectPath, null);
          }

          // If the destination branch was this branch, clear it.
          if ((effectiveCfg.branch ?? "").trim() === w.branch) {
            const next: SessionConfigDisk = { ...(effectiveCfg as SessionConfigDisk), branch: null };
            setLocalCfg(next);
            persist(next).catch(() => {});
          }

          onRefreshSessions();
          refreshWorktrees().catch(() => {});
          refreshBranches().catch(() => {});
          setWorktreeStatus("Deleted");
        } catch (e) {
          setError(String(e));
          setWorktreeStatus(null);
        } finally {
          setWorktreeBusy(false);
          window.setTimeout(() => setWorktreeStatus(null), 1600);
        }
      };

      setConfirmOpen(true);
    },
    [
      tauriAvailable,
      projectPath,
      session,
      effectiveCfg,
      worktreeBusy,
      saving,
      switchSessionLocation,
      persist,
      onRefreshSessions,
      refreshWorktrees,
      refreshBranches,
    ],
  );

  const switchToDirNow = useCallback(
    async (dir: string, branch: string | null, sourceLabel: string) => {
      if (!tauriAvailable || !projectPath || !session) return;
      const targetDir = dir.trim();
      if (!targetDir) return;

      setError(null);
      setWorktreeBusy(true);
      setWorktreeStatus("Switching…");
      try {
        await switchSessionLocation(targetDir, branch);
        onRefreshSessions();
        setWorktreeStatus(`Switched (${sourceLabel})`);
      } catch (e) {
        setError(String(e));
        setWorktreeStatus(null);
      } finally {
        setWorktreeBusy(false);
        window.setTimeout(() => setWorktreeStatus(null), 1400);
      }
    },
    [tauriAvailable, projectPath, session, switchSessionLocation, onRefreshSessions],
  );

  const requestSwitchToDir = useCallback(
    (dir: string, branch: string | null, label: string) => {
      if (!tauriAvailable || !projectPath || !session) return;
      if (worktreeBusy || saving) return;

      const wantsRoot = dir === projectPath;
      setConfirmTitle(wantsRoot ? "Switch To Root?" : "Switch To Worktree?");
      setConfirmBody(
        wantsRoot
          ? `Switch this pane to the project root?\n\n${projectPath}\n\nSource: ${label}`
          : `Switch this pane to this directory?\n\n${dir}\n\nSource: ${label}`,
      );
      setConfirmCta("Yes, switch");
      setConfirmTone("blue");
      confirmActionRef.current = async () => {
        await switchToDirNow(dir, branch, label);
      };
      setConfirmOpen(true);
    },
    [tauriAvailable, projectPath, session, worktreeBusy, saving, switchToDirNow],
  );

  const currentLocation = useMemo(() => {
    if (!session || !projectPath) return { kind: "unknown" as const };
    const wdRaw = session.workingDir ?? "";
    if (!wdRaw) return { kind: "unknown" as const };
    const wd = normalizePathForMatch(wdRaw);
    const root = normalizePathForMatch(projectPath);

    // The project root itself is also listed as a git worktree; treat it as "root" in this UI.
    if (root && (wd === root || wd.startsWith(`${root}/`))) return { kind: "root" as const };

    // Consider the user "in" a worktree if their WD is inside a non-root worktree path.
    const inWt = worktrees.find((w) => {
      const wtPath = normalizePathForMatch(w.path);
      if (!wtPath || wtPath === root) return false;
      return wd === wtPath || wd.startsWith(`${wtPath}/`);
    });
    if (inWt) return { kind: "worktree" as const, worktree: inWt };
    return { kind: "other" as const, wd: wdRaw };
  }, [session?.workingDir, worktrees, projectPath]);

  const sortedWorktrees = useMemo(
    () => {
      const root = normalizePathForMatch(projectPath);
      return worktrees
        .filter((w) => {
          const wtPath = normalizePathForMatch(w.path);
          return !!wtPath && wtPath !== root;
        })
        .sort((a, b) => (a.branch ?? a.path).localeCompare(b.branch ?? b.path));
    },
    [worktrees, projectPath],
  );

  const quickSwitchOptions = useMemo(() => {
    const options: {
      value: string;
      title: string;
      optionLabel: string;
      path: string;
      branch: string | null;
      worktree: WorktreeInfo | null;
    }[] = [
      {
        value: QUICK_SWITCH_ROOT,
        title: "Project root",
        optionLabel: projectPath ? `Project root - ${readablePath(projectPath, projectPath)}` : "Project root",
        path: projectPath ?? "",
        branch: null,
        worktree: null,
      },
    ];
    for (const w of sortedWorktrees) {
      const title = worktreeDisplayName(w);
      options.push({
        value: w.path,
        title,
        optionLabel: `${title} - ${readablePath(w.path, projectPath)}`,
        path: w.path,
        branch: w.branch ?? null,
        worktree: w,
      });
    }
    return options;
  }, [sortedWorktrees, projectPath]);

  const selectedQuickSwitch = useMemo(
    () => quickSwitchOptions.find((o) => o.value === quickSwitchValue) ?? null,
    [quickSwitchOptions, quickSwitchValue],
  );
  const selectedQuickSwitchWorktree = selectedQuickSwitch?.worktree ?? null;
  const currentWorktreePath = currentLocation.kind === "worktree" ? currentLocation.worktree.path : "";

  useEffect(() => {
    if (!open) return;
    if (currentLocation.kind === "worktree") {
      setQuickSwitchValue(currentLocation.worktree.path);
    } else {
      setQuickSwitchValue(QUICK_SWITCH_ROOT);
    }
  }, [open, session?.sessionId, currentLocation.kind, currentWorktreePath]);

  useEffect(() => {
    if (quickSwitchOptions.some((o) => o.value === quickSwitchValue)) return;
    setQuickSwitchValue(QUICK_SWITCH_ROOT);
  }, [quickSwitchOptions, quickSwitchValue]);

  useEffect(() => {
    if (!open) return;
    setWorktreesView("switch");
  }, [open, session?.sessionId]);

  const selectedQuickSwitchIsCurrent = useMemo(() => {
    if (!selectedQuickSwitch) return false;
    if (selectedQuickSwitch.value === QUICK_SWITCH_ROOT) return currentLocation.kind === "root";
    return currentLocation.kind === "worktree" && currentLocation.worktree.path === selectedQuickSwitch.value;
  }, [selectedQuickSwitch, currentLocation]);
  const activeWorktreesView = useMemo(
    () => WORKTREES_VIEWS.find((v) => v.id === worktreesView) ?? WORKTREES_VIEWS[0],
    [worktreesView],
  );
  const worktreeStats = useMemo(() => {
    const total = sortedWorktrees.length;
    const synkManaged = sortedWorktrees.filter((w) => w.isSynkManaged).length;
    const locked = sortedWorktrees.filter((w) => w.locked).length;
    return { total, synkManaged, locked };
  }, [sortedWorktrees]);

  const desiredBranchRaw = useMemo(() => (effectiveCfg?.branch ?? "").trim(), [effectiveCfg?.branch]);
  const desiredBranchNormalized = useMemo(
    () => (desiredBranchRaw ? normalizeDestinationBranch(desiredBranchRaw) : ""),
    [desiredBranchRaw, normalizeDestinationBranch],
  );
  const desiredWorktree = useMemo(() => {
    if (!desiredBranchNormalized) return null;
    return worktrees.find((w) => w.branch === desiredBranchNormalized) ?? null;
  }, [worktrees, desiredBranchNormalized]);

  // Removed: "auto-enter destination" (worktree isolation) feature.

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
          {confirmOpen ? (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4">
              <div className="w-full max-w-lg rounded-2xl border border-border bg-bg-secondary shadow-[0_22px_70px_rgba(0,0,0,0.55)]">
                <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold tracking-[0.18em] text-text-secondary">
                      CONFIRM
                    </div>
                    <div className="mt-1 truncate text-sm font-semibold text-text-primary">{confirmTitle}</div>
                  </div>
                  <button
                    type="button"
                    className="rounded-md border border-border bg-bg-tertiary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover"
                    onClick={() => {
                      confirmActionRef.current = null;
                      setConfirmOpen(false);
                    }}
                    title="Cancel"
                  >
                    ×
                  </button>
                </div>
                <div className="px-4 py-3">
                  <div className="whitespace-pre-wrap font-mono text-[12px] leading-relaxed text-text-secondary">
                    {confirmBody}
                  </div>
                  <div className="mt-4 flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-xl border border-border bg-bg-tertiary px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
                      disabled={worktreeBusy}
                      onClick={() => {
                        confirmActionRef.current = null;
                        setConfirmOpen(false);
                      }}
                    >
                      No
                    </button>
                    <button
                      type="button"
                      className={[
                        "rounded-xl border px-3 py-2 text-xs font-semibold disabled:opacity-60",
                        confirmTone === "red"
                          ? "border-accent-red/45 bg-accent-red/10 text-accent-red hover:bg-accent-red/15"
                          : "border-accent-blue/45 bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/15",
                      ].join(" ")}
                      disabled={worktreeBusy}
                      onClick={() => {
                        const fn = confirmActionRef.current;
                        confirmActionRef.current = null;
                        setConfirmOpen(false);
                        fn?.().catch(() => {});
                      }}
                    >
                      {confirmCta}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mt-2 rounded-lg border border-accent-red/40 bg-accent-red/10 px-2 py-2 text-[11px] text-accent-red">
              {error}
            </div>
          ) : null}

          <div className="mt-3 rounded-xl border border-border bg-bg-secondary p-2">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">AGENT</div>
            <div className="mt-1 rounded-lg border border-border bg-bg-tertiary px-2 py-2 text-xs text-text-primary">
              {agentLabel(session.agentType)}
              <span className="ml-2 font-mono text-[10px] text-text-secondary">({session.agentType})</span>
            </div>
          </div>

          <div className="mt-2 rounded-xl border border-border bg-bg-secondary p-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">WORKTREES</div>
                <div className="mt-0.5 text-[11px] text-text-secondary">
                  Move this pane now, configure a destination branch, or manage existing worktrees.
                </div>
              </div>
              <button
                type="button"
                className="rounded-lg border border-border bg-bg-tertiary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
                disabled={!tauriAvailable || saving || worktreeBusy}
                onClick={() => {
                  refreshWorktrees().catch(() => {});
                  refreshBranches().catch(() => {});
                }}
                title="Refresh worktree/branch lists"
              >
                Refresh
              </button>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-bg-tertiary p-1">
              {WORKTREES_VIEWS.map((view) => {
                const active = worktreesView === view.id;
                return (
                  <button
                    key={view.id}
                    type="button"
                    onClick={() => setWorktreesView(view.id)}
                    className={[
                      "rounded-md px-2 py-1.5 text-center transition-colors",
                      active
                        ? "border border-accent-blue/45 bg-accent-blue/10"
                        : "border border-transparent hover:bg-bg-hover",
                    ].join(" ")}
                    aria-pressed={active}
                    title={view.hint}
                  >
                    <div className={["text-[10px] font-semibold tracking-[0.08em]", active ? "text-accent-blue" : "text-text-secondary"].join(" ")}>
                      {view.label}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="mt-1 px-1 text-[10px] text-text-secondary/80">{activeWorktreesView.hint}</div>

            <div className="mt-2 rounded-lg border border-border bg-bg-tertiary px-2 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold text-text-primary">Current location</div>
                  <div className="mt-0.5 text-[11px] leading-relaxed text-text-secondary">
                    {currentLocation.kind === "worktree" ? (
                      <>
                        <div className="text-[12px] font-semibold text-text-primary">
                          {worktreeDisplayName(currentLocation.worktree)}
                        </div>
                        <div className="mt-0.5 break-words font-mono text-[11px] text-text-secondary" title={currentLocation.worktree.path}>
                          {readablePath(currentLocation.worktree.path, projectPath)}
                        </div>
                      </>
                    ) : currentLocation.kind === "root" ? (
                      <>
                        <div className="text-[12px] font-semibold text-text-primary">Project root</div>
                        <div className="mt-0.5 break-words font-mono text-[11px] text-text-secondary" title={projectPath ?? ""}>
                          {readablePath(projectPath ?? "", projectPath)}
                        </div>
                      </>
                    ) : currentLocation.kind === "other" ? (
                      <>
                        <div className="text-[12px] font-semibold text-text-primary">Other directory</div>
                        <div className="mt-0.5 break-words font-mono text-[11px] text-text-secondary" title={currentLocation.wd}>
                          {readablePath(currentLocation.wd, projectPath)}
                        </div>
                      </>
                    ) : (
                      "(unknown)"
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-border bg-bg-secondary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
                  disabled={!tauriAvailable || saving || worktreeBusy || !projectPath || currentLocation.kind === "root"}
                  title="Switch this pane to the project root"
                  onClick={() => requestSwitchToDir(projectPath ?? "", null, "Quick switch: root")}
                >
                  Root
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <div className="rounded-md border border-border bg-bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-text-secondary/80">
                  {worktreeStats.total} total
                </div>
                <div className="rounded-md border border-border bg-bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-text-secondary/80">
                  {worktreeStats.synkManaged} synk
                </div>
                {worktreeStats.locked ? (
                  <div className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-orange">
                    {worktreeStats.locked} locked
                  </div>
                ) : null}
              </div>
            </div>

            {worktreesView === "switch" ? (
              <div className="mt-2 rounded-lg border border-border bg-bg-tertiary px-2 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold text-text-primary">Quick switch</div>
                  <div className="font-mono text-[10px] text-text-secondary/70">{worktreeStats.total} worktrees</div>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2">
                  <label className="flex flex-col gap-1">
                    <div className="text-[11px] font-semibold text-text-secondary">Switch target</div>
                    <select
                      className="h-9 w-full rounded-lg border border-border bg-bg-secondary px-2 text-[12px] text-text-primary disabled:opacity-60"
                      value={quickSwitchValue}
                      disabled={!tauriAvailable || saving || worktreeBusy || !projectPath || !session}
                      onChange={(e) => setQuickSwitchValue(e.target.value)}
                    >
                      {quickSwitchOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.optionLabel}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedQuickSwitch ? (
                    <div className="rounded-lg border border-border bg-bg-secondary px-2 py-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <div className="text-[12px] font-semibold text-text-primary">{selectedQuickSwitch.title}</div>
                        {selectedQuickSwitchIsCurrent ? (
                          <div className="rounded-md border border-accent-blue/45 bg-accent-blue/10 px-1.5 py-0.5 text-[10px] text-accent-blue">
                            current
                          </div>
                        ) : null}
                        {selectedQuickSwitchWorktree?.isSynkManaged ? (
                          <div className="rounded-md border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary">
                            synk
                          </div>
                        ) : null}
                        {selectedQuickSwitchWorktree?.detached ? (
                          <div className="rounded-md border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary">
                            detached
                          </div>
                        ) : null}
                        {selectedQuickSwitchWorktree?.locked ? (
                          <div className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-1.5 py-0.5 text-[10px] text-accent-orange">
                            locked
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-1 break-words font-mono text-[11px] text-text-secondary" title={selectedQuickSwitch.path}>
                        {readablePath(selectedQuickSwitch.path, projectPath)}
                      </div>
                    </div>
                  ) : null}

                  {worktreeStats.total === 0 ? (
                    <div className="text-[11px] text-text-secondary/70">
                      No worktrees yet. Use <span className="font-semibold text-text-secondary">Destination</span> to create one.
                    </div>
                  ) : null}

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="h-9 shrink-0 rounded-lg border border-accent-blue/45 bg-accent-blue/10 px-3 text-[11px] font-semibold text-accent-blue hover:bg-accent-blue/15 disabled:opacity-60"
                      disabled={
                        !tauriAvailable ||
                        saving ||
                        worktreeBusy ||
                        !projectPath ||
                        !session ||
                        !selectedQuickSwitch ||
                        selectedQuickSwitchIsCurrent
                      }
                      title={
                        selectedQuickSwitchIsCurrent
                          ? "This pane is already in the selected location"
                          : "Switch this pane to the selected location"
                      }
                      onClick={() => {
                        if (!selectedQuickSwitch || !projectPath) return;
                        if (selectedQuickSwitch.value === QUICK_SWITCH_ROOT) {
                          requestSwitchToDir(projectPath, null, "Quick switch: root");
                          return;
                        }
                        requestSwitchToDir(
                          selectedQuickSwitch.path,
                          selectedQuickSwitch.branch,
                          `Quick switch: ${selectedQuickSwitch.title}`,
                        );
                      }}
                    >
                      {selectedQuickSwitchIsCurrent ? "Current" : "Switch"}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {worktreesView === "destination" ? (
              <div className="mt-2 rounded-lg border border-border bg-bg-tertiary px-2 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-text-primary">Destination branch</div>
                    <div className="mt-0.5 text-[11px] text-text-secondary">
                      Set a branch target for this pane, then create and switch when ready.
                    </div>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-border bg-bg-secondary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
                    disabled={!tauriAvailable || saving || worktreeBusy || !effectiveCfg || !desiredBranchRaw}
                    title="Clear destination branch"
                    onClick={() => {
                      if (!effectiveCfg) return;
                      const next: SessionConfigDisk = {
                        ...(effectiveCfg as SessionConfigDisk),
                        branch: null,
                      };
                      setLocalCfg(next);
                      persist(next).catch(() => {});
                    }}
                  >
                    Clear
                  </button>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-2">
                  <label className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] font-semibold text-text-secondary">Branch</div>
                      <div className="font-mono text-[10px] text-text-secondary/70">prefix {branchPrefix || "(none)"}</div>
                    </div>
                    <input
                      className="h-9 w-full rounded-lg border border-border bg-bg-secondary px-2 font-mono text-[12px] text-text-primary disabled:opacity-60"
                      placeholder={branchPrefix ? `${branchPrefix}phase-4` : "phase-4"}
                      list="synk-branch-suggest"
                      value={effectiveCfg?.branch ?? ""}
                      disabled={!tauriAvailable || saving || worktreeBusy}
                      onChange={(e) => {
                        if (!effectiveCfg) return;
                        const next = { ...(effectiveCfg as SessionConfigDisk), branch: e.target.value };
                        setLocalCfg(next);
                      }}
                      onBlur={() => {
                        if (!effectiveCfg) return;
                        persist(effectiveCfg).catch(() => {});
                      }}
                    />
                    <datalist id="synk-branch-suggest">
                      {branches.map((b) => (
                        <option key={b} value={b} />
                      ))}
                    </datalist>

                    {desiredBranchNormalized ? (
                      <div className="flex items-center justify-between gap-2 text-[11px] text-text-secondary/70">
                        <div className="min-w-0 truncate">
                          Will use <span className="font-mono text-text-secondary">{desiredBranchNormalized}</span>
                        </div>
                        <div
                          className={[
                            "flex-none rounded-md border px-1.5 py-0.5 font-mono text-[10px]",
                            desiredWorktree
                              ? "border-accent-green/40 bg-accent-green/10 text-accent-green"
                              : "border-border bg-bg-tertiary text-text-secondary",
                          ].join(" ")}
                          title={desiredWorktree?.path ?? "Worktree will be created on switch"}
                        >
                          {desiredWorktree ? "exists" : "new"}
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-text-secondary/70">
                        Tip: type <span className="font-mono">phase-4</span> and Synk will apply the prefix.
                      </div>
                    )}
                  </label>

                  <div className="flex items-center gap-2">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px] font-semibold text-text-secondary">
                      Create from
                      {branches.length ? (
                        <select
                          className="h-9 w-full rounded-lg border border-border bg-bg-secondary px-2 font-mono text-[12px] text-text-primary disabled:opacity-60"
                          value={baseBranch}
                          disabled={!tauriAvailable || saving || worktreeBusy || !desiredBranchRaw}
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
                          className="h-9 w-full rounded-lg border border-border bg-bg-secondary px-2 font-mono text-[12px] text-text-primary disabled:opacity-60"
                          value={baseBranch}
                          disabled={!tauriAvailable || saving || worktreeBusy || !desiredBranchRaw}
                          placeholder="main"
                          onChange={(e) => setBaseBranch(e.target.value)}
                        />
                      )}
                    </label>

                    <button
                      type="button"
                      className="h-9 shrink-0 rounded-lg border border-accent-blue/45 bg-accent-blue/10 px-3 text-[11px] font-semibold text-accent-blue hover:bg-accent-blue/15 disabled:opacity-60"
                      disabled={
                        !tauriAvailable || saving || worktreeBusy || !session || !projectPath || !desiredBranchRaw || !baseBranch.trim()
                      }
                      title="Create the worktree (if needed) and switch this pane into it"
                      onClick={() => requestSwitch(desiredBranchRaw, "Destination: create + switch")}
                    >
                      Create + switch
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {worktreesView === "manage" ? (
              <div className="mt-2 rounded-lg border border-border bg-bg-tertiary px-2 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold text-text-primary">Manage worktrees</div>
                  <div className="font-mono text-[10px] text-text-secondary/70">{worktreeStats.total} listed</div>
                </div>

                {worktreeStats.total === 0 ? (
                  <div className="mt-2 text-[11px] text-text-secondary/70">
                    No worktrees found yet.
                  </div>
                ) : (
                  <div className="mt-2 grid grid-cols-1 gap-1.5">
                    {sortedWorktrees.map((w) => {
                      const label = worktreeDisplayName(w);
                      const isCurrent = currentLocation.kind === "worktree" && currentLocation.worktree.path === w.path;
                      return (
                        <div
                          key={w.path}
                          className={[
                            "flex items-start justify-between gap-2 rounded-lg border px-2 py-2",
                            isCurrent ? "border-accent-blue/50 bg-accent-blue/10" : "border-border bg-bg-secondary",
                          ].join(" ")}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <div className="text-[12px] font-semibold text-text-primary">{label}</div>
                              {isCurrent ? (
                                <div className="rounded-md border border-accent-blue/45 bg-accent-blue/10 px-1.5 py-0.5 text-[10px] text-accent-blue">
                                  current
                                </div>
                              ) : null}
                              {w.isSynkManaged ? (
                                <div className="rounded-md border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary">
                                  synk
                                </div>
                              ) : null}
                              {w.detached ? (
                                <div className="rounded-md border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary">
                                  detached
                                </div>
                              ) : null}
                              {w.locked ? (
                                <div className="rounded-md border border-accent-orange/40 bg-accent-orange/10 px-1.5 py-0.5 text-[10px] text-accent-orange">
                                  locked
                                </div>
                              ) : null}
                            </div>
                            <div className="mt-1 break-words font-mono text-[11px] text-text-secondary/80" title={w.path}>
                              {readablePath(w.path, projectPath)}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              className="rounded-lg border border-border bg-bg-tertiary px-2 py-1 text-[11px] font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary disabled:opacity-60"
                              disabled={!tauriAvailable || saving || worktreeBusy || !projectPath || !session || isCurrent}
                              title={isCurrent ? "This pane is already in this worktree" : "Switch this pane into this worktree"}
                              onClick={() => requestSwitchToDir(w.path, w.branch ?? null, `Manage: ${label}`)}
                            >
                              {isCurrent ? "Current" : "Open"}
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-2 py-1 text-[11px] font-semibold text-accent-red hover:bg-accent-red/15 disabled:opacity-60"
                              disabled={
                                !tauriAvailable ||
                                saving ||
                                worktreeBusy ||
                                !projectPath ||
                                !session ||
                                !w.isSynkManaged ||
                                !w.branch ||
                                w.locked
                              }
                              title={
                                !w.isSynkManaged
                                  ? "Only Synk-managed worktrees can be deleted from the UI"
                                  : !w.branch
                                    ? "Detached worktrees can't be deleted from the UI yet"
                                    : w.locked
                                      ? "Worktree is locked"
                                      : "Delete this worktree (also deletes the branch)"
                              }
                              onClick={() => requestDeleteWorktree(w)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}

            {worktreeStatus ? <div className="mt-2 text-[11px] text-text-secondary/80">{worktreeStatus}</div> : null}
          </div>

          <div className="mt-3 rounded-xl border border-border bg-bg-secondary p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">SKILLS</div>
                <div className="font-mono text-[10px] text-text-secondary">{activeSkillsTab.label}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-bg-tertiary p-1">
              {SKILL_AGENT_TABS.map((tab) => {
                const active = tab.id === activeSkillsTab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSkillsAgentTab(tab.id)}
                    className={[
                      "rounded-md px-2 py-1 text-[10px] font-semibold tracking-[0.08em] transition-colors",
                      active
                        ? "border border-accent-blue/45 bg-accent-blue/10 text-accent-blue"
                        : "border border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary",
                    ].join(" ")}
                    aria-pressed={active}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2">
              <SkillsBrowser
                key={activeSkillsTab.id}
                tauriAvailable={tauriAvailable}
                projectPath={projectPath}
                agentType={activeSkillsTab.id}
                title={activeSkillsTab.title}
              />
            </div>
            <div className="mt-2 text-[11px] text-text-secondary/75">
              Skills are global per-agent. This session currently runs{" "}
              <span className="font-mono">{agentLabel(selectedAgentType)}</span>.
            </div>
          </div>

          <div className="mt-3 rounded-xl border border-border bg-bg-secondary p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">MCP SERVERS</div>
                <div className="font-mono text-[10px] text-text-secondary">{activeMcpTab.label}</div>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-bg-tertiary p-1">
              {MCP_AGENT_TABS.map((tab) => {
                const active = tab.id === activeMcpTab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setMcpAgentTab(tab.id)}
                    className={[
                      "rounded-md px-2 py-1 text-[10px] font-semibold tracking-[0.08em] transition-colors",
                      active
                        ? "border border-accent-blue/45 bg-accent-blue/10 text-accent-blue"
                        : "border border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary",
                    ].join(" ")}
                    aria-pressed={active}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
            <div className="mt-2">
              <McpManager
                key={activeMcpTab.id}
                tauriAvailable={tauriAvailable}
                projectPath={projectPath}
                agentType={activeMcpTab.id}
                title={activeMcpTab.title}
                allowToggle={activeMcpTab.id === "claude_code"}
              />
            </div>
            <div className="mt-2 text-[11px] text-text-secondary/75">
              MCP is global per-agent. This session currently runs{" "}
              <span className="font-mono">{agentLabel(selectedAgentType)}</span>.
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-[11px] text-text-secondary">
              {status ? <span className="font-mono">{status}</span> : null}
            </div>
            <button
              className="rounded-lg border border-border bg-bg-tertiary px-2.5 py-2 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60"
              disabled={!tauriAvailable || saving || sourcesBusy}
              onClick={() => refreshSources(selectedAgentType).catch(() => {})}
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
