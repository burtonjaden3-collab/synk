import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  AiProviderId,
  AppSettings,
  MergeStrategy,
  NotificationsSettings,
  ProviderKeyValidationResult,
  ProviderModelsResult,
  TerminalExitMethod,
  ToastPosition,
} from "../../lib/types";
import {
  settingsGet,
  settingsListProviderModels,
  settingsOllamaPullModel,
  settingsSet,
  settingsValidateProviderKey,
} from "../../lib/tauri-api";
import { useAppStore } from "../../lib/store";
import { defaultAppSettings } from "../../lib/default-settings";
import { KNOWN_MODELS, mergeModelLists } from "../../lib/known-models";

type SettingsProps = {
  open: boolean;
  tauriAvailable: boolean;
  onClose: () => void;
};

type TabId =
  | "ai"
  | "performance"
  | "keyboard"
  | "appearance"
  | "notifications"
  | "git"
  | "sessions"
  | "about";

const NOTIFICATION_TOGGLES: ReadonlyArray<{
  key: keyof Pick<NotificationsSettings, "taskCompleted" | "agentError" | "mergeConflict" | "reviewReady">;
  label: string;
}> = [
  { key: "taskCompleted", label: "Task completed" },
  { key: "agentError", label: "Agent error" },
  { key: "mergeConflict", label: "Merge conflict" },
  { key: "reviewReady", label: "Review ready" },
];

const ALL_AI_PROVIDERS: readonly AiProviderId[] = ["anthropic", "google", "openai", "openrouter", "ollama"];

function defaultSettings(): AppSettings {
  return defaultAppSettings();
}

function ensureAiProvidersShape(aiProviders: unknown): AppSettings["aiProviders"] {
  const defaults = defaultAppSettings().aiProviders;
  const raw = (aiProviders ?? {}) as Partial<AppSettings["aiProviders"]>;
  const nextDefault = raw.default as AiProviderId | undefined;
  return {
    default: nextDefault && ALL_AI_PROVIDERS.includes(nextDefault) ? nextDefault : defaults.default,
    anthropic: { ...defaults.anthropic, ...(raw.anthropic ?? {}) },
    google: { ...defaults.google, ...(raw.google ?? {}) },
    openai: { ...defaults.openai, ...(raw.openai ?? {}) },
    openrouter: { ...defaults.openrouter, ...(raw.openrouter ?? {}) },
    ollama: { ...defaults.ollama, ...(raw.ollama ?? {}) },
  };
}

function ensureSettingsShape(input: AppSettings): AppSettings {
  return {
    ...input,
    aiProviders: ensureAiProvidersShape((input as { aiProviders?: unknown }).aiProviders),
  };
}

function clampInt(n: number, min: number, max: number): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function clampFloat(n: number, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function normalizeSettings(s: AppSettings): AppSettings {
  return {
    ...s,
    performance: {
      ...s.performance,
      initialPoolSize: clampInt(s.performance.initialPoolSize, 0, 12),
      maxPoolSize: clampInt(s.performance.maxPoolSize, 1, 64),
      maxActiveSessions: clampInt(s.performance.maxActiveSessions, 1, 64),
      maxPtyAgeMinutes: clampInt(s.performance.maxPtyAgeMinutes, 1, 24 * 60),
      warmupDelayMs: clampInt(s.performance.warmupDelayMs, 0, 5000),
      pollIntervalMs: clampInt(s.performance.pollIntervalMs, 250, 60000),
    },
    ui: {
      ...s.ui,
      sidebarWidth: clampInt(s.ui.sidebarWidth, 220, 520),
      drawerHeight: clampInt(s.ui.drawerHeight, 160, 520),
      unfocusedOpacity: clampFloat(s.ui.unfocusedOpacity, 0.35, 1),
    },
    session: {
      ...s.session,
      autoSaveIntervalSeconds: clampInt(s.session.autoSaveIntervalSeconds, 10, 3600),
    },
    keyboard: {
      ...s.keyboard,
      doubleEscapeTimeoutMs: clampInt(s.keyboard.doubleEscapeTimeoutMs, 50, 1200),
    },
  };
}

function tabLabel(id: TabId) {
  switch (id) {
    case "ai":
      return { title: "AI Providers", hint: "auth + defaults" };
    case "performance":
      return { title: "Performance", hint: "pool + limits" };
    case "keyboard":
      return { title: "Keyboard", hint: "exit method" };
    case "appearance":
      return { title: "Appearance", hint: "layout + opacity" };
    case "notifications":
      return { title: "Notifications", hint: "toasts + toggles" };
    case "git":
      return { title: "Git", hint: "merge + worktrees" };
    case "sessions":
      return { title: "Sessions", hint: "auto-save" };
    case "about":
      return { title: "About", hint: "build + paths" };
  }
}

function providerModelUsageHint(provider: AiProviderId): string {
  switch (provider) {
    case "anthropic":
      return "Used for new/restarted Claude Code sessions.";
    case "google":
      return "Used for new/restarted Gemini CLI sessions.";
    case "openai":
      return "Used for new/restarted Codex sessions.";
    case "openrouter":
      return "Used for OpenRouter model defaults.";
    case "ollama":
      return "Used for local Ollama model defaults.";
  }
}

function providerApiKey(settings: AppSettings["aiProviders"], provider: Exclude<AiProviderId, "ollama">): string {
  const safe = ensureAiProvidersShape(settings);
  switch (provider) {
    case "anthropic":
      return safe.anthropic.apiKey ?? "";
    case "google":
      return safe.google.apiKey ?? "";
    case "openai":
      return safe.openai.apiKey ?? "";
    case "openrouter":
      return safe.openrouter.apiKey ?? "";
  }
}

function pill(ok: boolean | null) {
  if (ok === null) return { text: "...", cls: "border-border text-text-secondary bg-bg-primary" };
  if (ok) return { text: "OK", cls: "border-accent-green/40 text-accent-green bg-accent-green/10" };
  return { text: "X", cls: "border-accent-red/40 text-accent-red bg-accent-red/10" };
}

export function Settings(props: SettingsProps) {
  const { open, onClose, tauriAvailable } = props;

  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);

  const [tab, setTab] = useState<TabId>("ai");
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [validation, setValidation] = useState<Record<string, ProviderKeyValidationResult | null>>({});
  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({});
  const [modelsStatus, setModelsStatus] = useState<Record<string, ProviderModelsResult | null>>({});
  const [modelsBusy, setModelsBusy] = useState<Record<string, boolean>>({});
  const [ollamaInstallModel, setOllamaInstallModel] = useState("");
  const [ollamaInstallBusy, setOllamaInstallBusy] = useState(false);
  const [ollamaInstallMessage, setOllamaInstallMessage] = useState<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const validateTimersRef = useRef<Record<string, number | null>>({});
  const autoLoadedModelKeyRef = useRef<Record<string, string>>({});
  const initializedForOpenRef = useRef(false);

  const tabs: TabId[] = useMemo(
    () => ["ai", "performance", "keyboard", "appearance", "notifications", "git", "sessions", "about"],
    [],
  );

  const saveNow = async (next: AppSettings) => {
    if (!tauriAvailable) {
      setError("Browser preview mode: settings persistence requires `npm run tauri dev`.");
      return;
    }
    setSaving(true);
    setError(null);
    setStatus("Saving...");
    try {
      const normalized = normalizeSettings(next);
      const saved = await settingsSet(normalized);
      setSettings(saved);
      setDraft(saved);
      setStatus("Saved");
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
      }
      statusTimerRef.current = window.setTimeout(() => {
        statusTimerRef.current = null;
        setStatus(null);
      }, 1200);
    } catch (e) {
      setError(String(e));
      setStatus(null);
    } finally {
      setSaving(false);
    }
  };

  const scheduleSave = (next: AppSettings) => {
    if (!tauriAvailable) return;
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      saveNow(next).catch(() => {});
    }, 450);
  };

  const scheduleValidate = (provider: AiProviderId, apiKey: string) => {
    if (!tauriAvailable) return;
    const key = apiKey.trim();
    if (key.length < 8) return;

    const existing = validateTimersRef.current[provider];
    if (existing != null) window.clearTimeout(existing);

    validateTimersRef.current[provider] = window.setTimeout(() => {
      validateTimersRef.current[provider] = null;
      settingsValidateProviderKey(provider, key)
        .then((res) => setValidation((m) => ({ ...m, [provider]: res })))
        .catch((e) =>
          setValidation((m) => ({
            ...m,
            [provider]: { ok: false, message: String(e), statusCode: null },
          })),
        );
    }, 900);
  };

  useEffect(() => {
    if (!open) {
      initializedForOpenRef.current = false;
      return;
    }
    if (initializedForOpenRef.current) return;
    initializedForOpenRef.current = true;

    setError(null);
    setStatus(null);
    setValidation({});
    setModelsByProvider({});
    setModelsStatus({});
    setModelsBusy({});
    setOllamaInstallModel("");
    setOllamaInstallBusy(false);
    setOllamaInstallMessage(null);
    setShowKeys({});
    autoLoadedModelKeyRef.current = {};

    if (settings) {
      setDraft(settings);
      return;
    }

    setDraft(defaultSettings());
    if (tauriAvailable) {
      settingsGet()
        .then((s) => {
          setSettings(s);
          setDraft(s);
        })
        .catch(() => {
          // keep defaults
        });
    }
  }, [open, settings, setSettings, tauriAvailable]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (statusTimerRef.current !== null) {
        window.clearTimeout(statusTimerRef.current);
        statusTimerRef.current = null;
      }
      for (const id of Object.keys(validateTimersRef.current)) {
        const t = validateTimersRef.current[id];
        if (t != null) window.clearTimeout(t);
      }
      validateTimersRef.current = {};
    };
  }, []);

  const s = useMemo(() => ensureSettingsShape(draft ?? defaultSettings()), [draft]);

  const setDraftAndSave = (next: AppSettings) => {
    setDraft(next);
    scheduleSave(next);
  };

  const loadProviderModels = useCallback(
    async (providerId: AiProviderId, rawKey: string, baseUrl?: string) => {
      const apiKey = rawKey.trim();
      if (!tauriAvailable) return;
      if (providerId !== "ollama" && !apiKey) return;
      setModelsBusy((m) => ({ ...m, [providerId]: true }));
      try {
        const res = await settingsListProviderModels(providerId, apiKey, baseUrl ?? null);
        setModelsStatus((m) => ({ ...m, [providerId]: res }));
        setModelsByProvider((m) => ({ ...m, [providerId]: res.models ?? [] }));
      } catch (e) {
        setModelsStatus((m) => ({
          ...m,
          [providerId]: { ok: false, models: [], message: String(e), statusCode: null },
        }));
      } finally {
        setModelsBusy((m) => ({ ...m, [providerId]: false }));
      }
    },
    [tauriAvailable],
  );

  const loadOllamaModels = useCallback(
    async (baseUrl: string) => {
      await loadProviderModels("ollama", "", baseUrl);
    },
    [loadProviderModels],
  );

  // Auto-load latest model lists for API-key providers when settings open.
  useEffect(() => {
    if (!open || !tauriAvailable) return;
    if (!draft) return;
    const providers: Exclude<AiProviderId, "ollama">[] = ["anthropic", "openai", "openrouter", "google"];
    for (const providerId of providers) {
      const key = providerApiKey(draft.aiProviders, providerId).trim();
      if (key.length < 8) continue;
      if (autoLoadedModelKeyRef.current[providerId] === key) continue;
      autoLoadedModelKeyRef.current[providerId] = key;
      loadProviderModels(providerId, key).catch(() => {});
    }
  }, [open, tauriAvailable, draft, loadProviderModels]);

  // Keep Ollama models synced while Settings is open so newly-pulled models appear without manual refresh.
  useEffect(() => {
    if (!open || !tauriAvailable || !draft) return;
    const baseUrl = draft.aiProviders.ollama.baseUrl;
    loadOllamaModels(baseUrl).catch(() => {});
    const timer = window.setInterval(() => {
      loadOllamaModels(baseUrl).catch(() => {});
    }, 10000);
    return () => window.clearInterval(timer);
  }, [open, tauriAvailable, draft?.aiProviders.ollama.baseUrl, loadOllamaModels]);

  const ProviderCard = (p: { id: AiProviderId; title: string; desc: string }) => {
    if (p.id === "ollama") {
      const provider = s.aiProviders.ollama;
      const models = modelsByProvider[p.id] ?? [];
      const modelOptions = mergeModelLists(models, KNOWN_MODELS.ollama);
      const modelsMeta = modelsStatus[p.id] ?? null;
      const loadingModels = !!modelsBusy[p.id];

      const loadModels = async () => {
        await loadOllamaModels(provider.baseUrl);
      };

      const installModel = async () => {
        const model = (ollamaInstallModel || provider.defaultModel).trim();
        if (!model) return;
        setOllamaInstallBusy(true);
        setOllamaInstallMessage(null);
        try {
          const res = await settingsOllamaPullModel(model, provider.baseUrl);
          setOllamaInstallMessage(res.message);
          if (res.ok) {
            setOllamaInstallModel("");
            await loadModels();
          }
        } catch (e) {
          setOllamaInstallMessage(String(e));
        } finally {
          setOllamaInstallBusy(false);
        }
      };

      return (
        <div className="rounded-2xl border border-border bg-bg-secondary p-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">{p.title}</div>
              <div className="mt-1 break-words text-xs text-text-secondary">{p.desc}</div>
            </div>
            <div className="shrink-0 rounded-full border border-border bg-bg-primary px-2 py-1 font-mono text-[10px] text-text-secondary">
              local API
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
            <label className="block">
              <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">BASE URL</div>
              <input
                className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                value={provider.baseUrl}
                onChange={(e) =>
                  setDraftAndSave({
                    ...s,
                    aiProviders: {
                      ...s.aiProviders,
                      ollama: { ...s.aiProviders.ollama, baseUrl: e.target.value },
                    },
                  })
                }
              />
              <div className="mt-2 text-[11px] text-text-secondary">
                Polling every 10s while Settings is open.
              </div>
            </label>
            <label className="block min-w-0">
              <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">DEFAULT MODEL</div>
              <div className="mt-1 grid grid-cols-1 gap-2">
                <input
                  className="h-9 min-w-0 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                  list="synk-models-ollama"
                  value={provider.defaultModel}
                  placeholder="type a model name…"
                  onChange={(e) =>
                    setDraftAndSave({
                      ...s,
                      aiProviders: {
                        ...s.aiProviders,
                        ollama: { ...s.aiProviders.ollama, defaultModel: e.target.value },
                      },
                    })
                  }
                />
                <select
                  className="h-9 min-w-0 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                  value={modelOptions.includes(provider.defaultModel) ? provider.defaultModel : ""}
                  onChange={(e) =>
                    setDraftAndSave({
                      ...s,
                      aiProviders: {
                        ...s.aiProviders,
                        ollama: { ...s.aiProviders.ollama, defaultModel: e.target.value },
                      },
                    })
                  }
                  title={models.length ? "Models loaded from local Ollama" : "Curated starter list"}
                >
                  <option value="" disabled>
                    Pick…
                  </option>
                  {modelOptions.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <datalist id="synk-models-ollama">
                {modelOptions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <div className="mt-2 flex flex-col gap-2 text-[11px] text-text-secondary sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 break-words">
                  {models.length ? (
                    <>
                      {models.length} local models detected
                      {modelsMeta?.statusCode ? <span className="ml-1 opacity-70">({modelsMeta.statusCode})</span> : null}
                    </>
                  ) : (
                    "No local models detected yet (you can install one below)"
                  )}
                </div>
                <button
                  className="self-start rounded-md border border-border bg-bg-primary px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60 sm:self-auto"
                  disabled={loadingModels}
                  onClick={() => loadModels().catch(() => {})}
                  type="button"
                  title="Fetch models from local Ollama (/api/tags)"
                >
                  {loadingModels ? "Loading..." : models.length ? "Refresh" : "Load models"}
                </button>
              </div>
              <div className="mt-1 text-[11px] text-text-secondary/80">{providerModelUsageHint(p.id)}</div>
            </label>
          </div>

          <div className="mt-3 rounded-xl border border-border bg-bg-tertiary p-3">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">INSTALL MODEL</div>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                className="h-9 w-full rounded-lg border border-border bg-bg-primary px-2 text-xs text-text-primary"
                list="synk-models-ollama"
                placeholder="e.g. qwen2.5-coder:7b"
                value={ollamaInstallModel}
                onChange={(e) => setOllamaInstallModel(e.target.value)}
              />
              <button
                className="h-9 w-full shrink-0 rounded-lg border border-accent-blue/35 bg-bg-primary px-3 text-xs font-semibold text-text-primary hover:bg-bg-hover disabled:opacity-60 sm:w-auto"
                disabled={ollamaInstallBusy || !(ollamaInstallModel || provider.defaultModel).trim()}
                onClick={() => installModel().catch(() => {})}
                type="button"
                title="Pull model into local Ollama"
              >
                {ollamaInstallBusy ? "Installing..." : "Install"}
              </button>
            </div>
            <div className="mt-2 text-[11px] text-text-secondary">
              Runs <span className="font-mono">POST /api/pull</span> against your Ollama server.
            </div>
            {ollamaInstallMessage ? (
              <div className="mt-2 break-words text-[11px] text-text-secondary">{ollamaInstallMessage}</div>
            ) : null}
          </div>
        </div>
      );
    }

    const provider = s.aiProviders[p.id];
    const key = provider.apiKey ?? "";
    const authMode = provider.authMode ?? null;
    const v = validation[p.id] ?? null;
    const badge = pill(v ? v.ok : null);
    const models = modelsByProvider[p.id] ?? [];
    const modelOptions = mergeModelLists(models, KNOWN_MODELS[p.id]);
    const modelsMeta = modelsStatus[p.id] ?? null;
    const loadingModels = !!modelsBusy[p.id];

    const loadModels = async () => {
      const apiKey = (provider.apiKey ?? "").trim();
      if (!apiKey) return;
      await loadProviderModels(p.id, apiKey);
    };

    return (
      <div className="rounded-2xl border border-border bg-bg-secondary p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{p.title}</div>
            <div className="mt-1 break-words text-xs text-text-secondary">{p.desc}</div>
          </div>
          <div className={["shrink-0 rounded-full border px-2 py-1 font-mono text-[10px]", badge.cls].join(" ")}>
            {badge.text}
            {v?.statusCode ? <span className="ml-1 opacity-75">({v.statusCode})</span> : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
          <label className="block">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">AUTH MODE</div>
            <select
              className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
              value={authMode === "apiKey" ? "apiKey" : ""}
              onChange={(e) => {
                const nextMode = (e.target.value || null) as "apiKey" | null;
                setDraftAndSave({
                  ...s,
                  aiProviders: {
                    ...s.aiProviders,
                    [p.id]: { ...provider, authMode: nextMode },
                  },
                });
              }}
            >
              <option value="">(unset)</option>
              <option value="apiKey">API key</option>
            </select>
          </label>

          <label className="block min-w-0">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">DEFAULT MODEL</div>
            <div className="mt-1 grid grid-cols-1 gap-2">
              <input
                className="h-9 min-w-0 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                list={`synk-models-${p.id}`}
                value={provider.defaultModel}
                placeholder="type a model name…"
                onChange={(e) =>
                  setDraftAndSave({
                    ...s,
                    aiProviders: {
                      ...s.aiProviders,
                      [p.id]: { ...provider, defaultModel: e.target.value },
                    },
                  })
                }
              />
              <select
                className="h-9 min-w-0 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                value={modelOptions.includes(provider.defaultModel) ? provider.defaultModel : ""}
                onChange={(e) =>
                  setDraftAndSave({
                    ...s,
                    aiProviders: {
                      ...s.aiProviders,
                      [p.id]: { ...provider, defaultModel: e.target.value },
                    },
                  })
                }
                title={models.length ? "Models loaded from provider API" : "Curated starter list"}
              >
                <option value="" disabled>
                  Pick…
                </option>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <datalist id={`synk-models-${p.id}`}>
              {modelOptions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <div className="mt-2 flex flex-col gap-2 text-[11px] text-text-secondary sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 break-words">
                {models.length ? (
                  <>
                    {models.length} models loaded
                    {modelsMeta?.statusCode ? <span className="ml-1 opacity-70">({modelsMeta.statusCode})</span> : null}
                  </>
                ) : (
                  "Using curated model list (add API key to fetch latest provider models)"
                )}
              </div>
              <button
                className="self-start rounded-md border border-border bg-bg-primary px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60 sm:self-auto"
                disabled={loadingModels || !key.trim()}
                onClick={() => loadModels().catch(() => {})}
                type="button"
                title="Fetch model list from the provider API (requires API key)"
              >
                {loadingModels ? "Loading..." : models.length ? "Refresh" : "Load models"}
              </button>
            </div>
            <div className="mt-1 text-[11px] text-text-secondary/80">{providerModelUsageHint(p.id)}</div>
          </label>
        </div>

        <div className="mt-3 rounded-xl border border-border bg-bg-tertiary p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">API KEY</div>
            <button
              className="rounded-md border border-border bg-bg-primary px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover"
              onClick={() => setShowKeys((m) => ({ ...m, [p.id]: !m[p.id] }))}
              type="button"
            >
              {showKeys[p.id] ? "Hide" : "Show"}
            </button>
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className="h-9 w-full rounded-lg border border-border bg-bg-primary px-2 font-mono text-[12px] text-text-primary"
              type={showKeys[p.id] ? "text" : "password"}
              placeholder="paste key..."
              value={key}
              onChange={(e) => {
                const nextKey = e.target.value;
                setDraftAndSave({
                  ...s,
                  aiProviders: {
                    ...s.aiProviders,
                    [p.id]: { ...provider, apiKey: nextKey ? nextKey : null },
                  },
                });
                setValidation((m) => ({ ...m, [p.id]: null }));
                scheduleValidate(p.id, nextKey);
              }}
            />
            <button
              className="h-9 w-full shrink-0 rounded-lg border border-accent-blue/35 bg-bg-primary px-3 text-xs font-semibold text-text-primary hover:bg-bg-hover disabled:opacity-60 sm:w-auto"
              disabled={saving || !key.trim()}
              onClick={async () => {
                try {
                  const res = await settingsValidateProviderKey(p.id, key);
                  setValidation((m) => ({ ...m, [p.id]: res }));
                  if (res.ok && (modelsByProvider[p.id]?.length ?? 0) === 0) {
                    loadModels().catch(() => {});
                  }
                } catch (e) {
                  setValidation((m) => ({
                    ...m,
                    [p.id]: { ok: false, message: String(e), statusCode: null },
                  }));
                }
              }}
              type="button"
              title="Validate key with a quick API request"
            >
              Validate
            </button>
          </div>
          {v ? (
            <div
              className={[
                "mt-2 rounded-lg border px-2 py-2 text-[11px]",
                v.ok
                  ? "border-accent-green/35 bg-accent-green/10 text-accent-green"
                  : "border-accent-red/35 bg-accent-red/10 text-accent-red",
              ].join(" ")}
            >
              {v.message || (v.ok ? "Valid" : "Invalid")}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-text-secondary">
              Paste an API key and click Validate to test connectivity.
            </div>
          )}
          <div className="mt-2 break-words text-[11px] text-text-secondary">
            Stored in plaintext in <span className="break-all font-mono">~/.config/synk/settings.json</span>.
          </div>
        </div>
      </div>
    );
  };

  if (!open) return null;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-labelledby="settings-dialog-title"
    >
      <div
        className="relative w-full max-w-6xl overflow-hidden rounded-[28px] border border-border bg-bg-secondary shadow-[0_40px_120px_rgba(0,0,0,0.65)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-accent-blue/10 blur-3xl" />
          <div className="absolute -bottom-28 -right-28 h-[520px] w-[520px] rounded-full bg-accent-green/8 blur-3xl" />
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, rgba(255,255,255,0.07) 0, rgba(255,255,255,0.07) 1px, transparent 1px, transparent 9px)",
            }}
          />
        </div>

        <div className="relative flex h-[min(90vh,760px)] min-h-0 w-full flex-col md:h-[min(82vh,760px)] md:flex-row">
          <div className="flex w-full min-h-0 shrink-0 flex-col border-b border-border bg-[#181825] md:w-[270px] md:border-b-0 md:border-r">
            <div className="flex min-w-0 items-start justify-between gap-3 border-b border-border px-4 py-4">
              <div className="min-w-0">
                <div className="font-mono text-[11px] font-semibold tracking-[0.22em] text-text-secondary">
                  SETTINGS
                </div>
                <div className="mt-1 text-sm font-semibold text-text-primary" id="settings-dialog-title">
                  Synk
                </div>
                <div className="mt-1 text-[11px] text-text-secondary">
                  <span className="font-mono">Ctrl+,</span> to toggle
                </div>
              </div>
              <button
                className="shrink-0 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover"
                onClick={onClose}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 [overscroll-behavior:contain]">
              <div className="space-y-2">
                {tabs.map((id) => {
                  const l = tabLabel(id);
                  const active = id === tab;
                  return (
                    <button
                      key={id}
                      className={[
                        "w-full min-w-0 rounded-xl border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-accent-blue/45 bg-bg-secondary"
                          : "border-border bg-bg-tertiary hover:bg-bg-hover",
                      ].join(" ")}
                      onClick={() => setTab(id)}
                      type="button"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0 break-words text-xs font-semibold text-text-primary">{l.title}</div>
                        <div className="shrink-0 rounded-full border border-border bg-bg-primary px-2 py-0.5 font-mono text-[10px] text-text-secondary">
                          {id}
                        </div>
                      </div>
                      <div className="mt-1 break-words text-[11px] text-text-secondary">{l.hint}</div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 rounded-2xl border border-border bg-bg-secondary p-3">
                <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">STATUS</div>
                <div className="mt-1 text-[11px] text-text-secondary">
                  {saving ? "Saving..." : status ? status : "Idle"}
                </div>
                {error ? (
                  <div className="mt-2 break-words rounded-xl border border-accent-red/40 bg-accent-red/10 px-2 py-2 text-[11px] text-accent-red">
                    {error}
                  </div>
                ) : null}
                <button
                  className="mt-3 w-full rounded-xl border border-border bg-bg-tertiary px-3 py-2 text-xs font-semibold text-text-primary hover:bg-bg-hover disabled:opacity-60"
                  disabled={saving}
                  onClick={() => saveNow(s)}
                  type="button"
                >
                  Save Now
                </button>
              </div>
            </div>
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <div className="h-full min-h-0 overflow-y-auto px-4 py-5 md:px-6 [overscroll-behavior:contain]">
              {tab === "ai" ? (
                <div>
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold tracking-tight">AI Providers</div>
                      <div className="mt-1 text-sm text-text-secondary">
                        Pick defaults, set auth, and validate connectivity.
                      </div>
                    </div>
                    <label className="block">
                      <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                        DEFAULT PROVIDER
                      </div>
                      <select
                        className="mt-1 h-9 rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                        value={s.aiProviders.default}
                        onChange={(e) =>
                          setDraftAndSave({
                            ...s,
                            aiProviders: { ...s.aiProviders, default: e.target.value as AiProviderId },
                          })
                        }
                      >
                        <option value="anthropic">anthropic</option>
                        <option value="google">google</option>
                        <option value="openai">openai</option>
                        <option value="openrouter">openrouter</option>
                        <option value="ollama">ollama</option>
                      </select>
                    </label>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <ProviderCard id="anthropic" title="Anthropic" desc="Claude via API key" />
                    <ProviderCard id="openai" title="OpenAI" desc="Chat Completions via API key" />
                    <ProviderCard id="openrouter" title="OpenRouter" desc="Open-source + hosted models via API key" />
                    <ProviderCard id="google" title="Google" desc="Gemini via API key" />
                    <ProviderCard id="ollama" title="Ollama" desc="Local models via REST API" />
                  </div>
                </div>
              ) : null}

              {tab === "performance" ? (
                <div>
                  <div className="text-lg font-semibold tracking-tight">Performance</div>
                  <div className="mt-1 text-sm text-text-secondary">
                    These control the PTY pool and session limits. Changes apply immediately for new sessions.
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Pool Sizing</div>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            INITIAL
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            type="number"
                            min={0}
                            max={12}
                            value={s.performance.initialPoolSize}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                performance: { ...s.performance, initialPoolSize: Number(e.target.value) },
                              })
                            }
                          />
                        </label>
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            MAX POOL
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            type="number"
                            min={1}
                            max={64}
                            value={s.performance.maxPoolSize}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                performance: { ...s.performance, maxPoolSize: Number(e.target.value) },
                              })
                            }
                          />
                        </label>
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            MAX ACTIVE
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            type="number"
                            min={1}
                            max={64}
                            value={s.performance.maxActiveSessions}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                performance: { ...s.performance, maxActiveSessions: Number(e.target.value) },
                              })
                            }
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex items-start justify-between gap-2 rounded-xl border border-border bg-bg-tertiary px-3 py-3">
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            RECYCLE
                          </div>
                          <div className="mt-1 break-words text-[11px] text-text-secondary">
                            Keep shells warm between sessions for faster startup.
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={s.performance.recycleEnabled}
                          onChange={(e) =>
                            setDraftAndSave({
                              ...s,
                              performance: { ...s.performance, recycleEnabled: e.target.checked },
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Timing</div>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            PTY AGE (MIN)
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            type="number"
                            min={1}
                            max={1440}
                            value={s.performance.maxPtyAgeMinutes}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                performance: { ...s.performance, maxPtyAgeMinutes: Number(e.target.value) },
                              })
                            }
                          />
                        </label>
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            WARMUP DELAY (MS)
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            type="number"
                            min={0}
                            max={5000}
                            value={s.performance.warmupDelayMs}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                performance: { ...s.performance, warmupDelayMs: Number(e.target.value) },
                              })
                            }
                          />
                        </label>
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            POLL (MS)
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            type="number"
                            min={250}
                            max={60000}
                            value={s.performance.pollIntervalMs}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                performance: { ...s.performance, pollIntervalMs: Number(e.target.value) },
                              })
                            }
                          />
                        </label>
                      </div>
                      <div className="mt-3 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-[11px] text-text-secondary">
                        RAM estimate: very rough. A larger warm pool improves latency but costs memory.
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "keyboard" ? (
                <div>
                  <div className="text-lg font-semibold tracking-tight">Keyboard</div>
                  <div className="mt-1 text-sm text-text-secondary">How to exit terminal mode back to navigation.</div>

                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Terminal Exit Method</div>
                      <div className="mt-3">
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            METHOD
                          </div>
                          <select
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            value={s.keyboard.terminalExitMethod}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                keyboard: {
                                  ...s.keyboard,
                                  terminalExitMethod: e.target.value as TerminalExitMethod,
                                },
                              })
                            }
                          >
                            <option value="double_escape">Double Escape</option>
                            <option value="ctrl_backslash">Ctrl+\\</option>
                            <option value="ctrl_shift_escape">Ctrl+Shift+Escape</option>
                          </select>
                        </label>
                      </div>

                      <div className="mt-3">
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            DOUBLE ESC TIMEOUT (MS)
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary disabled:opacity-60"
                            type="number"
                            min={50}
                            max={1200}
                            disabled={s.keyboard.terminalExitMethod !== "double_escape"}
                            value={s.keyboard.doubleEscapeTimeoutMs}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                keyboard: { ...s.keyboard, doubleEscapeTimeoutMs: Number(e.target.value) },
                              })
                            }
                          />
                        </label>
                      </div>

                      <div className="mt-3 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-[11px] text-text-secondary">
                        Double-Escape is the default because single Escape should still reach Vim inside the terminal.
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Custom Bindings</div>
                      <div className="mt-2 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-[11px] text-text-secondary">
                        Custom bindings editor ships later. The settings file already reserves a{" "}
                        <span className="font-mono">customBindings</span> map.
                      </div>
                      <pre className="mt-3 overflow-auto rounded-xl border border-border bg-bg-primary p-3 text-[11px] text-text-secondary">
                        {JSON.stringify(s.keyboard.customBindings ?? {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "appearance" ? (
                <div>
                  <div className="text-lg font-semibold tracking-tight">Appearance</div>
                  <div className="mt-1 text-sm text-text-secondary">UI sizing and focus behavior.</div>

                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Layout</div>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            SIDEBAR WIDTH
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            type="number"
                            min={220}
                            max={520}
                            value={s.ui.sidebarWidth}
                            onChange={(e) =>
                              setDraftAndSave({ ...s, ui: { ...s.ui, sidebarWidth: Number(e.target.value) } })
                            }
                          />
                        </label>
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            DRAWER HEIGHT
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            type="number"
                            min={160}
                            max={520}
                            value={s.ui.drawerHeight}
                            onChange={(e) =>
                              setDraftAndSave({ ...s, ui: { ...s.ui, drawerHeight: Number(e.target.value) } })
                            }
                          />
                        </label>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Focus</div>
                      <div className="mt-3 flex items-start justify-between gap-2 rounded-xl border border-border bg-bg-tertiary px-3 py-3">
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            DIM UNFOCUSED
                          </div>
                          <div className="mt-1 break-words text-[11px] text-text-secondary">
                            When in terminal mode, reduce opacity for other panes.
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={s.ui.dimUnfocusedPanes}
                          onChange={(e) =>
                            setDraftAndSave({ ...s, ui: { ...s.ui, dimUnfocusedPanes: e.target.checked } })
                          }
                        />
                      </div>
                      <div className="mt-3">
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            UNFOCUSED OPACITY
                          </div>
                          <input
                            className="mt-1 w-full"
                            type="range"
                            min={0.35}
                            max={1}
                            step={0.01}
                            value={s.ui.unfocusedOpacity}
                            onChange={(e) =>
                              setDraftAndSave({ ...s, ui: { ...s.ui, unfocusedOpacity: Number(e.target.value) } })
                            }
                          />
                          <div className="mt-1 font-mono text-[10px] text-text-secondary">
                            {s.ui.unfocusedOpacity.toFixed(2)}
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "notifications" ? (
                <div>
                  <div className="text-lg font-semibold tracking-tight">Notifications</div>
                  <div className="mt-1 text-sm text-text-secondary">Toast defaults and per-type toggles.</div>

                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Toggles</div>
                      <div className="mt-3 space-y-2">
                        {NOTIFICATION_TOGGLES.map(({ key, label }) => (
                          <label
                            key={key}
                            className="flex cursor-pointer items-start justify-between gap-2 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-xs hover:bg-bg-hover"
                          >
                            <span className="min-w-0 break-words text-text-primary">{label}</span>
                            <input
                              type="checkbox"
                              checked={s.notifications[key]}
                              onChange={(e) =>
                                setDraftAndSave({
                                  ...s,
                                  notifications: { ...s.notifications, [key]: e.target.checked },
                                })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Behavior</div>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            POSITION
                          </div>
                          <select
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            value={s.notifications.position}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                notifications: {
                                  ...s.notifications,
                                  position: e.target.value as ToastPosition,
                                },
                              })
                            }
                          >
                            <option value="top-right">top-right</option>
                            <option value="top-left">top-left</option>
                            <option value="bottom-right">bottom-right</option>
                            <option value="bottom-left">bottom-left</option>
                          </select>
                        </label>
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            DURATION (MS)
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            type="number"
                            min={500}
                            max={60000}
                            value={s.notifications.durationMs}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                notifications: { ...s.notifications, durationMs: Number(e.target.value) },
                              })
                            }
                          />
                        </label>
                      </div>
                      <div className="mt-3 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-[11px] text-text-secondary">
                        Toast UI ships later; these values are persisted now.
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "git" ? (
                <div>
                  <div className="text-lg font-semibold tracking-tight">Git</div>
                  <div className="mt-1 text-sm text-text-secondary">
                    Defaults for merge operations and worktree layout.
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Merge</div>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            STRATEGY
                          </div>
                          <select
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            value={s.git.defaultMergeStrategy}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                git: { ...s.git, defaultMergeStrategy: e.target.value as MergeStrategy },
                              })
                            }
                          >
                            <option value="merge">merge</option>
                            <option value="squash">squash</option>
                            <option value="rebase">rebase</option>
                          </select>
                        </label>
                        <label className="flex cursor-pointer items-start justify-between gap-2 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-xs hover:bg-bg-hover">
                          <span className="min-w-0 break-words text-text-primary">Auto-delegate conflicts</span>
                          <input
                            type="checkbox"
                            checked={s.git.autoDelegateConflicts}
                            onChange={(e) =>
                              setDraftAndSave({ ...s, git: { ...s.git, autoDelegateConflicts: e.target.checked } })
                            }
                          />
                        </label>
                      </div>
                      <div className="mt-3 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-[11px] text-text-secondary">
                        Worktree engine ships in Phase 3; these values are persisted now.
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Worktrees</div>
                      <div className="mt-3 grid grid-cols-1 gap-3">
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            BASE PATH
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 font-mono text-[12px] text-text-primary"
                            value={s.git.worktreeBasePath}
                            onChange={(e) =>
                              setDraftAndSave({ ...s, git: { ...s.git, worktreeBasePath: e.target.value } })
                            }
                          />
                        </label>
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            BRANCH PREFIX
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 font-mono text-[12px] text-text-primary"
                            value={s.git.branchPrefix}
                            onChange={(e) =>
                              setDraftAndSave({ ...s, git: { ...s.git, branchPrefix: e.target.value } })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "sessions" ? (
                <div>
                  <div className="text-lg font-semibold tracking-tight">Sessions</div>
                  <div className="mt-1 text-sm text-text-secondary">Session auto-save controls.</div>

                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Auto-Save</div>
                      <div className="mt-3 flex items-start justify-between gap-2 rounded-xl border border-border bg-bg-tertiary px-3 py-3">
                        <div className="min-w-0">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            ENABLED
                          </div>
                          <div className="mt-1 break-words text-[11px] text-text-secondary">
                            Saves layout snapshots for crash recovery.
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={s.session.autoSave}
                          onChange={(e) =>
                            setDraftAndSave({ ...s, session: { ...s.session, autoSave: e.target.checked } })
                          }
                        />
                      </div>
                      <div className="mt-3">
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            INTERVAL (SECONDS)
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary disabled:opacity-60"
                            type="number"
                            min={10}
                            max={3600}
                            disabled={!s.session.autoSave}
                            value={s.session.autoSaveIntervalSeconds}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                session: { ...s.session, autoSaveIntervalSeconds: Number(e.target.value) },
                              })
                            }
                          />
                        </label>
                      </div>
                      <div className="mt-3 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-[11px] text-text-secondary">
                        Snapshot files live in <span className="break-all font-mono">~/.config/synk/sessions/</span>.
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "about" ? (
                <div>
                  <div className="text-lg font-semibold tracking-tight">About</div>
                  <div className="mt-1 text-sm text-text-secondary">Build info and storage paths.</div>

                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Storage</div>
                      <div className="mt-3 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-[12px] text-text-secondary">
                        <div>
                          Global: <span className="break-all font-mono">~/.config/synk/</span>
                        </div>
                        <div className="mt-1">
                          Settings: <span className="break-all font-mono">~/.config/synk/settings.json</span>
                        </div>
                        <div className="mt-1">
                          Sessions: <span className="break-all font-mono">~/.config/synk/sessions/</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Version</div>
                      <div className="mt-3 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-[12px] text-text-secondary">
                        <div>
                          App: <span className="font-mono">0.1.0</span>
                        </div>
                        <div className="mt-1">
                          Settings schema: <span className="font-mono">v{s.version}</span>
                        </div>
                      </div>
                      <div className="mt-3 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-[11px] text-text-secondary">
                        Tip: close this panel with <span className="font-mono">Esc</span>.
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
