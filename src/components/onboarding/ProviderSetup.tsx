import { useMemo, useState } from "react";

import type { AiProviderId, AppSettings, ProviderKeyValidationResult, ProviderModelsResult } from "../../lib/types";
import { settingsListProviderModels, settingsValidateProviderKey } from "../../lib/tauri-api";
import { KNOWN_MODELS, mergeModelLists } from "../../lib/known-models";

type ProviderSetupProps = {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
};

function pill(ok: boolean | null): { text: string; cls: string } {
  if (ok === null) return { text: "not checked", cls: "border-border bg-bg-primary text-text-secondary" };
  if (ok) return { text: "valid", cls: "border-accent-green/40 bg-accent-green/10 text-accent-green" };
  return { text: "invalid", cls: "border-accent-red/40 bg-accent-red/10 text-accent-red" };
}

export function ProviderSetup(props: ProviderSetupProps) {
  const s = props.settings;

  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [validation, setValidation] = useState<Record<string, ProviderKeyValidationResult | null>>({});
  const [validateBusy, setValidateBusy] = useState<Record<string, boolean>>({});

  const [modelsByProvider, setModelsByProvider] = useState<Record<string, string[]>>({});
  const [modelsBusy, setModelsBusy] = useState<Record<string, boolean>>({});
  const [modelsStatus, setModelsStatus] = useState<Record<string, ProviderModelsResult | null>>({});

  const providers = useMemo(
    () =>
      [
        { id: "anthropic" as const, title: "Anthropic", desc: "Claude via API key" },
        { id: "openai" as const, title: "OpenAI", desc: "Chat Completions via API key" },
        { id: "openrouter" as const, title: "OpenRouter", desc: "Open-source + hosted models via API key" },
        { id: "google" as const, title: "Google", desc: "Gemini via API key" },
        { id: "ollama" as const, title: "Ollama", desc: "Local models via REST API" },
      ] satisfies Array<{ id: AiProviderId; title: string; desc: string }>,
    [],
  );

  const ProviderCard = (p: { id: AiProviderId; title: string; desc: string }) => {
    if (p.id === "ollama") {
      return (
        <div className="rounded-2xl border border-border bg-bg-secondary p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{p.title}</div>
              <div className="mt-1 text-xs text-text-secondary">{p.desc}</div>
            </div>
            <div className="rounded-full border border-accent-green/35 bg-accent-green/10 px-2 py-1 font-mono text-[10px] text-accent-green">
              auto-detected
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block">
              <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">BASE URL</div>
              <input
                className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                value={s.aiProviders.ollama.baseUrl}
                onChange={(e) =>
                  props.onChange({
                    ...s,
                    aiProviders: { ...s.aiProviders, ollama: { ...s.aiProviders.ollama, baseUrl: e.target.value } },
                  })
                }
              />
              <div className="mt-2 text-[11px] text-text-secondary">
                Synk will connect if Ollama is running at this URL.
              </div>
            </label>

            <label className="block">
              <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">DEFAULT MODEL</div>
              <input
                className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                value={s.aiProviders.ollama.defaultModel}
                onChange={(e) =>
                  props.onChange({
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
    const validating = !!validateBusy[p.id];
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
              value={authMode === "apiKey" ? "apiKey" : ""}
              onChange={(e) => {
                const nextMode = (e.target.value || null) as "apiKey" | null;
                props.onChange({
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

          <label className="block">
            <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">DEFAULT MODEL</div>
            <div className="mt-1 flex items-center gap-2">
              <input
                className="h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
                list={`synk-onboarding-models-${p.id}`}
                value={provider.defaultModel}
                placeholder="type a model name…"
                onChange={(e) =>
                  props.onChange({
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
                  props.onChange({
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
            <datalist id={`synk-onboarding-models-${p.id}`}>
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
                  "Using curated model list (you can still type a model name)"
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
              placeholder="paste key..."
              value={key}
              onChange={(e) => {
                const nextKey = e.target.value;
                props.onChange({
                  ...s,
                  aiProviders: {
                    ...s.aiProviders,
                    [p.id]: { ...provider, apiKey: nextKey ? nextKey : null },
                  },
                });
                setValidation((m) => ({ ...m, [p.id]: null }));
              }}
            />
            <button
              className="h-9 shrink-0 rounded-lg border border-accent-blue/35 bg-bg-primary px-3 text-xs font-semibold text-text-primary hover:bg-bg-hover disabled:opacity-60"
              disabled={validating || !key.trim()}
              onClick={async () => {
                setValidateBusy((m) => ({ ...m, [p.id]: true }));
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
                } finally {
                  setValidateBusy((m) => ({ ...m, [p.id]: false }));
                }
              }}
              type="button"
              title={key.trim() ? "Validate key with a quick API request" : "Paste an API key to validate"}
            >
              {validating ? "Validating..." : "Validate"}
            </button>
          </div>
          {v ? (
            <div
              className={[
                "mt-2 rounded-lg border px-2 py-2 text-[11px]",
                v.ok ? "border-accent-green/35 bg-accent-green/10 text-accent-green" : "border-accent-red/35 bg-accent-red/10 text-accent-red",
              ].join(" ")}
            >
              {v.message || (v.ok ? "Valid" : "Invalid")}
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-text-secondary">
              Paste an API key and click Validate to test connectivity.
            </div>
          )}
          <div className="mt-2 text-[11px] text-text-secondary">
            API keys are stored in plaintext in <span className="font-mono">~/.config/synk/settings.json</span>.
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-lg font-semibold tracking-tight">Set up your AI providers</div>
          <div className="mt-1 text-sm text-text-secondary">
            Configure API keys now, or skip and do this later in Settings.
          </div>
        </div>
        <label className="block">
          <div className="text-[10px] font-semibold tracking-[0.14em] text-text-secondary">DEFAULT PROVIDER</div>
          <select
            className="mt-1 h-9 rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary"
            value={s.aiProviders.default}
            onChange={(e) => props.onChange({ ...s, aiProviders: { ...s.aiProviders, default: e.target.value as AiProviderId } })}
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
        {providers.map((p) => (
          <ProviderCard key={p.id} {...p} />
        ))}
      </div>
    </div>
  );
}
