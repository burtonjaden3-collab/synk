import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AiProviderId,
  AppSettings,
  MergeStrategy,
  ProviderKeyValidationResult,
  ProviderModelsResult,
  TerminalExitMethod,
  ToastPosition,
} from "../../lib/types";
import {
  settingsGet,
  settingsListProviderModels,
  settingsSet,
  settingsValidateProviderKey,
} from "../../lib/tauri-api";
import { useAppStore } from "../../lib/store";
import { defaultAppSettings } from "../../lib/default-settings";
import { openUrl } from "@tauri-apps/plugin-opener";
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
  | "integrations"
  | "about";

function defaultSettings(): AppSettings {
  return defaultAppSettings();
}

function oauthUrlFor(provider: AiProviderId): string {
  switch (provider) {
    case "anthropic":
      return "https://claude.ai";
    case "google":
      return "https://aistudio.google.com";
    case "openai":
      return "https://platform.openai.com";
    case "ollama":
      return "http://localhost:11434";
  }
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
    case "integrations":
      return { title: "Integrations", hint: "gastown" };
    case "about":
      return { title: "About", hint: "build + paths" };
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
  const saveTimerRef = useRef<number | null>(null);
  const validateTimersRef = useRef<Record<string, number | null>>({});

  const tabs: TabId[] = useMemo(
    () => ["ai", "performance", "keyboard", "appearance", "notifications", "git", "sessions", "integrations", "about"],
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
      window.setTimeout(() => setStatus(null), 1200);
    } catch (e) {
      setError(String(e));
      setStatus(null);
    } finally {
      setSaving(false);
    }
  };

  const scheduleSave = (next: AppSettings) => {
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
    if (!open) return;

    setError(null);
    setStatus(null);
    setValidation({});
    setModelsByProvider({});
    setModelsStatus({});
    setModelsBusy({});
    setShowKeys({});

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
      for (const id of Object.keys(validateTimersRef.current)) {
        const t = validateTimersRef.current[id];
        if (t != null) window.clearTimeout(t);
      }
      validateTimersRef.current = {};
    };
  }, []);

  if (!open) return null;

  const s = draft ?? defaultSettings();

  const setDraftAndSave = (next: AppSettings) => {
    setDraft(next);
    scheduleSave(next);
  };

  const ProviderCard = (p: { id: AiProviderId; title: string; desc: string }) => {
    if (p.id === "ollama") {
      return (
        <div className="rounded-2xl border border-border bg-bg-secondary p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{p.title}</div>
              <div className="mt-1 text-xs text-text-secondary">{p.desc}</div>
            </div>
            <div className="rounded-full border border-border bg-bg-primary px-2 py-1 font-mono text-[10px] text-text-secondary">
              local
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">BASE URL</div>
              <input
                className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                value={s.aiProviders.ollama.baseUrl}
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
            </label>
            <label className="block">
              <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">DEFAULT MODEL</div>
              <input
                className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                value={s.aiProviders.ollama.defaultModel}
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
            </label>
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
    const modelOptions = useMemo(() => mergeModelLists(models, KNOWN_MODELS[p.id]), [models, p.id]);
    const modelsMeta = modelsStatus[p.id] ?? null;
    const loadingModels = !!modelsBusy[p.id];

    const loadModels = async () => {
      const apiKey = (provider.apiKey ?? "").trim();
      if (!apiKey) return;
      setModelsBusy((m) => ({ ...m, [p.id]: true }));
      try {
        const res = await settingsListProviderModels(p.id, apiKey);
        setModelsStatus((m) => ({ ...m, [p.id]: res }));
        if (res.models?.length) setModelsByProvider((m) => ({ ...m, [p.id]: res.models }));
      } catch (e) {
        setModelsStatus((m) => ({
          ...m,
          [p.id]: { ok: false, models: [], message: String(e), statusCode: null },
        }));
      } finally {
        setModelsBusy((m) => ({ ...m, [p.id]: false }));
      }
    };

    return (
      <div className="rounded-2xl border border-border bg-bg-secondary p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{p.title}</div>
            <div className="mt-1 text-xs text-text-secondary">{p.desc}</div>
          </div>
          <div className={["rounded-full border px-2 py-1 font-mono text-[10px]", badge.cls].join(" ")}>
            {badge.text}
            {v?.statusCode ? <span className="ml-1 opacity-75">({v.statusCode})</span> : null}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">AUTH MODE</div>
            <select
              className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
              value={authMode ?? ""}
              onChange={(e) => {
                const nextMode = (e.target.value || null) as "apiKey" | "oauth" | null;
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
              <option value="oauth">OAuth</option>
            </select>
          </label>

          <label className="block">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">DEFAULT MODEL</div>
            <div className="mt-1 flex items-center gap-2">
              <input
                className="h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
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
                className="h-9 w-[190px] rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
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
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-text-secondary">
              <div className="truncate">
                {models.length ? (
                  <>
                    {models.length} models loaded
                    {modelsMeta?.statusCode ? <span className="ml-1 opacity-70">({modelsMeta.statusCode})</span> : null}
                  </>
                ) : (
                  "Using curated model list"
                )}
              </div>
              <button
                className="rounded-md border border-border bg-bg-primary px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60"
                disabled={loadingModels || !key.trim()}
                onClick={() => loadModels().catch(() => {})}
                type="button"
                title="Fetch model list from the provider API (requires API key)"
              >
                {loadingModels ? "Loading..." : models.length ? "Refresh" : "Load models"}
              </button>
            </div>
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
          <div className="mt-2 flex items-center gap-2">
            <input
              className="h-9 w-full rounded-lg border border-border bg-bg-primary px-2 font-mono text-[12px] text-text-primary"
              type={showKeys[p.id] ? "text" : "password"}
              placeholder={authMode === "oauth" ? "(optional in OAuth mode)" : "paste key..."}
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
              className="h-9 shrink-0 rounded-lg border border-accent-blue/35 bg-bg-primary px-3 text-xs font-semibold text-text-primary hover:bg-bg-hover disabled:opacity-60"
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
          <div className="mt-2 text-[11px] text-text-secondary">
            Stored in plaintext in <span className="font-mono">~/.config/synk/settings.json</span>.
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-bg-tertiary p-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">OAUTH</div>
            <div className="mt-1 truncate text-[11px] text-text-secondary">
              {provider.oauthConnected ? `Connected as ${provider.oauthEmail ?? "(unknown)"}` : "Not connected"}
            </div>
          </div>
          <button
            className="rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs font-semibold text-text-secondary disabled:opacity-60"
            type="button"
            title="Opens the provider sign-in page. After signing in, mark connected so Synk can remember."
            onClick={async () => {
              // Phase 2 strict: provide a usable sign-in workflow and persist the connected flag.
              // Note: this does not obtain tokens yet; it only records that the user has signed in.
              try {
                await openUrl(oauthUrlFor(p.id));
              } catch {
                // ignore; user can still mark connected manually
              }
              const email = window.prompt("Enter the account email to display (optional):", provider.oauthEmail ?? "");
              setDraftAndSave({
                ...s,
                aiProviders: {
                  ...s.aiProviders,
                  [p.id]: {
                    ...provider,
                    authMode: "oauth",
                    oauthConnected: true,
                    oauthEmail: email && email.trim() ? email.trim() : null,
                  },
                },
              });
            }}
          >
            Sign In…
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4">
      <div className="relative w-full max-w-6xl overflow-hidden rounded-[28px] border border-border bg-bg-secondary shadow-[0_40px_120px_rgba(0,0,0,0.65)]">
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

        <div className="relative flex h-[min(82vh,760px)] min-h-0 w-full">
          <div className="flex w-[270px] min-h-0 shrink-0 flex-col border-r border-border bg-[#181825]">
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-4">
              <div>
                <div className="font-mono text-[11px] font-semibold tracking-[0.22em] text-text-secondary">
                  SETTINGS
                </div>
                <div className="mt-1 text-sm font-semibold text-text-primary">Synk</div>
                <div className="mt-1 text-[11px] text-text-secondary">
                  <span className="font-mono">Ctrl+,</span> to toggle
                </div>
              </div>
              <button
                className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover"
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
                        "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                        active
                          ? "border-accent-blue/45 bg-bg-secondary"
                          : "border-border bg-bg-tertiary hover:bg-bg-hover",
                      ].join(" ")}
                      onClick={() => setTab(id)}
                      type="button"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-xs font-semibold text-text-primary">{l.title}</div>
                        <div className="rounded-full border border-border bg-bg-primary px-2 py-0.5 font-mono text-[10px] text-text-secondary">
                          {id}
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-text-secondary">{l.hint}</div>
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
                  <div className="mt-2 rounded-xl border border-accent-red/40 bg-accent-red/10 px-2 py-2 text-[11px] text-accent-red">
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
            <div className="h-full min-h-0 overflow-y-auto px-6 py-5 [overscroll-behavior:contain]">
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
                        <option value="ollama">ollama</option>
                      </select>
                    </label>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <ProviderCard id="anthropic" title="Anthropic" desc="Claude via API key or OAuth" />
                    <ProviderCard id="openai" title="OpenAI" desc="Chat Completions via key or OAuth" />
                    <ProviderCard id="google" title="Google" desc="Gemini via API key or OAuth" />
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
                      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-bg-tertiary px-3 py-3">
                        <div>
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            RECYCLE
                          </div>
                          <div className="mt-1 text-[11px] text-text-secondary">
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
                      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-bg-tertiary px-3 py-3">
                        <div>
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            DIM UNFOCUSED
                          </div>
                          <div className="mt-1 text-[11px] text-text-secondary">
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
                        {(
                          [
                            ["taskCompleted", "Task completed"],
                            ["agentError", "Agent error"],
                            ["mergeConflict", "Merge conflict"],
                            ["reviewReady", "Review ready"],
                          ] as const
                        ).map(([k, label]) => (
                          <label
                            key={k}
                            className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-xs hover:bg-bg-hover"
                          >
                            <span className="text-text-primary">{label}</span>
                            <input
                              type="checkbox"
                              checked={(s.notifications as any)[k] as boolean}
                              onChange={(e) =>
                                setDraftAndSave({
                                  ...s,
                                  notifications: { ...s.notifications, [k]: e.target.checked } as any,
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
                        <label className="flex cursor-pointer items-center justify-between gap-2 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-xs hover:bg-bg-hover">
                          <span className="text-text-primary">Auto-delegate conflicts</span>
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
                      <div className="mt-3 flex items-center justify-between gap-2 rounded-xl border border-border bg-bg-tertiary px-3 py-3">
                        <div>
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            ENABLED
                          </div>
                          <div className="mt-1 text-[11px] text-text-secondary">
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
                        Snapshot files live in <span className="font-mono">~/.config/synk/sessions/</span>.
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "integrations" ? (
                <div>
                  <div className="text-lg font-semibold tracking-tight">Integrations</div>
                  <div className="mt-1 text-sm text-text-secondary">External tools and paths.</div>

                  <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Gastown</div>
                      <div className="mt-3 grid grid-cols-1 gap-3">
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            CLI PATH
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 font-mono text-[12px] text-text-primary"
                            placeholder="(auto-detect later)"
                            value={s.gastown.cliPath ?? ""}
                            onChange={(e) =>
                              setDraftAndSave({
                                ...s,
                                gastown: { ...s.gastown, cliPath: e.target.value ? e.target.value : null },
                              })
                            }
                          />
                        </label>
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            WORKSPACE PATH
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 font-mono text-[12px] text-text-primary"
                            value={s.gastown.workspacePath}
                            onChange={(e) =>
                              setDraftAndSave({ ...s, gastown: { ...s.gastown, workspacePath: e.target.value } })
                            }
                          />
                        </label>
                        <label className="block">
                          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
                            PINNED VERSION
                          </div>
                          <input
                            className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                            value={s.gastown.pinnedVersion}
                            onChange={(e) =>
                              setDraftAndSave({ ...s, gastown: { ...s.gastown, pinnedVersion: e.target.value } })
                            }
                          />
                        </label>
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
                          Global: <span className="font-mono">~/.config/synk/</span>
                        </div>
                        <div className="mt-1">
                          Settings: <span className="font-mono">~/.config/synk/settings.json</span>
                        </div>
                        <div className="mt-1">
                          Sessions: <span className="font-mono">~/.config/synk/sessions/</span>
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
