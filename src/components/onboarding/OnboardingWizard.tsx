import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import type { AppSettings } from "../../lib/types";
import { defaultAppSettings } from "../../lib/default-settings";
import { persistenceOpenProject, settingsSet, onboardingInitialize } from "../../lib/tauri-api";
import { useAppStore } from "../../lib/store";
import { ProviderSetup } from "./ProviderSetup";
import { AgentDetection } from "./AgentDetection";

function baseName(path: string): string {
  const parts = path.split(/[\\/]/g).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

type StepId = "welcome" | "providers" | "agents" | "project";

const steps: Array<{ id: StepId; title: string; hint: string }> = [
  { id: "welcome", title: "Welcome", hint: "Quick tour" },
  { id: "providers", title: "Providers", hint: "Optional setup" },
  { id: "agents", title: "Detection", hint: "Scan your system" },
  { id: "project", title: "First project", hint: "Open a folder" },
];

type OnboardingWizardProps = {
  onFinished: () => void;
  onExit?: () => void;
};

export function OnboardingWizard(props: OnboardingWizardProps) {
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);
  const storeSettings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);

  const initialSettings = useMemo<AppSettings>(() => storeSettings ?? defaultAppSettings(), [storeSettings]);
  const [draft, setDraft] = useState<AppSettings>(initialSettings);

  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projectMode, setProjectMode] = useState<"existing" | "new">("existing");
  const [pickedPath, setPickedPath] = useState<string>("");

  const current = steps[step]!;

  const next = () => setStep((s) => Math.min(steps.length - 1, s + 1));
  const prev = () => setStep((s) => Math.max(0, s - 1));

  const saveProviders = async () => {
    setError(null);
    setBusy(true);
    try {
      await onboardingInitialize();
      const saved = await settingsSet(draft);
      setSettings(saved);
      next();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const launch = async () => {
    if (!pickedPath.trim()) return;
    setError(null);
    setBusy(true);
    try {
      // Ensure global config skeleton exists (settings/projects/pricing + dirs).
      await onboardingInitialize();
      const proj = await persistenceOpenProject(pickedPath.trim());
      setCurrentProject(proj);
      props.onFinished();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="relative h-full min-h-full bg-bg-primary text-text-primary">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-[520px] w-[520px] rounded-full bg-accent-purple/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-28 h-[620px] w-[620px] rounded-full bg-accent-blue/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 8px)",
          }}
        />
      </div>

      <div className="relative mx-auto flex h-full max-w-6xl flex-col px-5 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[12px] font-semibold tracking-[0.22em] text-text-secondary">
              FIRST RUN
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <div className="text-4xl font-semibold tracking-tight">Welcome to Synk</div>
              <div className="hidden text-sm text-text-secondary sm:block">
                AI Agent Command Center for Developers
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {steps.map((s, idx) => {
              const active = idx === step;
              const done = idx < step;
              return (
                <div
                  key={s.id}
                  className={[
                    "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold",
                    active
                      ? "border-accent-blue/45 bg-bg-secondary text-text-primary"
                      : done
                        ? "border-accent-green/35 bg-accent-green/10 text-accent-green"
                        : "border-border bg-bg-secondary text-text-secondary",
                  ].join(" ")}
                  title={s.hint}
                >
                  <span className="font-mono">{idx + 1}</span>
                  <span className="hidden sm:inline">{s.title}</span>
                </div>
              );
            })}
          </div>
        </header>

        {error ? (
          <div className="mt-6 rounded-xl border border-accent-red/40 bg-bg-tertiary px-4 py-3 text-sm text-accent-red">
            {error}
          </div>
        ) : null}

        <main className="mt-8 flex-1">
          <div className="rounded-3xl border border-border bg-bg-secondary p-5 shadow-[0_26px_70px_rgba(0,0,0,0.45)]">
            {current.id === "welcome" ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="lg:col-span-7">
                  <div className="text-lg font-semibold tracking-tight">
                    Orchestrate multiple AI coding agents from one place.
                  </div>
                  <div className="mt-2 text-sm text-text-secondary">
                    This wizard sets up providers, checks which tools are installed, and opens your first project.
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-border bg-bg-tertiary p-4">
                      <div className="text-xs font-semibold text-text-primary">Providers</div>
                      <div className="mt-1 text-xs text-text-secondary">
                        API keys or OAuth (optional; can do later).
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-bg-tertiary p-4">
                      <div className="text-xs font-semibold text-text-primary">Agents</div>
                      <div className="mt-1 text-xs text-text-secondary">
                        Detect Claude Code, Gemini CLI, Codex, and more.
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-bg-tertiary p-4">
                      <div className="text-xs font-semibold text-text-primary">Project</div>
                      <div className="mt-1 text-xs text-text-secondary">
                        Pick a folder; Synk creates <span className="font-mono">.synk/</span>.
                      </div>
                    </div>
                    <div className="rounded-2xl border border-border bg-bg-tertiary p-4">
                      <div className="text-xs font-semibold text-text-primary">Recovery</div>
                      <div className="mt-1 text-xs text-text-secondary">
                        Skips are fine. Settings links are shown when features are unavailable.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5">
                  <div className="rounded-3xl border border-border bg-bg-tertiary p-5">
                    <div className="font-mono text-[11px] font-semibold tracking-[0.22em] text-text-secondary">
                      QUICK START
                    </div>
                    <div className="mt-3 text-sm font-semibold">Ready?</div>
                    <div className="mt-2 text-xs text-text-secondary">
                      You can finish this in under a minute.
                    </div>
                    <button
                      className="mt-5 w-full rounded-2xl border border-accent-blue/45 bg-bg-primary px-4 py-3 text-sm font-semibold text-text-primary shadow-[0_18px_45px_rgba(88,166,255,0.10)] hover:bg-bg-hover disabled:opacity-60"
                      disabled={busy}
                      onClick={() => next()}
                      type="button"
                    >
                      Get Started →
                    </button>
                    <div className="mt-4 text-[11px] text-text-secondary">
                      Onboarding only appears when <span className="font-mono">~/.config/synk/</span> doesn’t exist.
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {current.id === "providers" ? <ProviderSetup settings={draft} onChange={setDraft} /> : null}

            {current.id === "agents" ? <AgentDetection refreshToken={step} /> : null}

            {current.id === "project" ? (
              <div>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold tracking-tight">Your first project</div>
                    <div className="mt-1 text-sm text-text-secondary">
                      Open an existing folder to enter the workspace.
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
                  <div className="lg:col-span-6">
                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Mode</div>
                      <div className="mt-3 space-y-2">
                        <label className="flex items-start gap-3 rounded-xl border border-border bg-bg-tertiary px-3 py-3">
                          <input
                            className="mt-1"
                            type="radio"
                            checked={projectMode === "new"}
                            onChange={() => setProjectMode("new")}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-text-primary">Start a new project</div>
                            <div className="mt-1 text-xs text-text-secondary">
                              Brainstorm wizard ships later (disabled for now).
                            </div>
                          </div>
                        </label>

                        <label className="flex items-start gap-3 rounded-xl border border-accent-blue/35 bg-bg-tertiary px-3 py-3">
                          <input
                            className="mt-1"
                            type="radio"
                            checked={projectMode === "existing"}
                            onChange={() => setProjectMode("existing")}
                          />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-text-primary">Open an existing folder</div>
                            <div className="mt-1 text-xs text-text-secondary">Pick a directory to add to recent projects.</div>
                          </div>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-6">
                    <div className="rounded-2xl border border-border bg-bg-secondary p-4">
                      <div className="text-sm font-semibold">Folder</div>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          className="h-10 w-full rounded-xl border border-border bg-bg-tertiary px-3 font-mono text-[12px] text-text-primary disabled:opacity-60"
                          value={pickedPath}
                          placeholder={projectMode === "existing" ? "/path/to/your-project" : "brainstorm wizard coming soon"}
                          disabled
                          readOnly
                        />
                        <button
                          className="h-10 shrink-0 rounded-xl border border-border bg-bg-tertiary px-3 text-xs font-semibold text-text-primary hover:bg-bg-hover disabled:opacity-60"
                          disabled={busy || projectMode !== "existing"}
                          onClick={async () => {
                            setError(null);
                            try {
                              const picked = await open({
                                directory: true,
                                multiple: false,
                                title: "Open Folder",
                              });
                              if (!picked) return;
                              const path = Array.isArray(picked) ? picked[0] : picked;
                              if (!path) return;
                              setPickedPath(path);
                            } catch (e) {
                              setError(String(e));
                            }
                          }}
                          type="button"
                        >
                          Browse
                        </button>
                      </div>

                      <div className="mt-3 rounded-xl border border-border bg-bg-tertiary px-3 py-3 text-xs text-text-secondary">
                        {pickedPath ? (
                          <>
                            Selected: <span className="font-mono text-text-primary">{pickedPath}</span>
                            <div className="mt-1 font-mono text-[11px] opacity-90">
                              creates <span className="text-text-primary">.synk/</span> and adds it to recent projects
                            </div>
                          </>
                        ) : (
                          <>No folder selected yet.</>
                        )}
                      </div>

                      <div className="mt-3 font-mono text-[11px] text-text-secondary">
                        {pickedPath ? `cd ${baseName(pickedPath)}` : "cd your-project"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </main>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-text-secondary">
            Step <span className="font-mono">{step + 1}</span>/<span className="font-mono">{steps.length}</span>:{" "}
            <span className="text-text-primary">{current.title}</span>
          </div>

          <div className="flex items-center gap-2">
            {props.onExit ? (
              <button
                className="rounded-xl border border-border bg-bg-secondary px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-hover disabled:opacity-60"
                disabled={busy}
                onClick={() => props.onExit?.()}
                type="button"
              >
                Exit
              </button>
            ) : null}
            <button
              className="rounded-xl border border-border bg-bg-secondary px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-hover disabled:opacity-60"
              disabled={busy || step === 0}
              onClick={() => prev()}
              type="button"
            >
              Back
            </button>

            {current.id === "providers" ? (
              <>
                <button
                  className="rounded-xl border border-border bg-bg-secondary px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-hover disabled:opacity-60"
                  disabled={busy}
                  onClick={() => next()}
                  type="button"
                >
                  Skip for now
                </button>
                <button
                  className="rounded-xl border border-accent-blue/45 bg-bg-secondary px-4 py-2 text-xs font-semibold text-text-primary hover:bg-bg-hover disabled:opacity-60"
                  disabled={busy}
                  onClick={() => saveProviders().catch(() => {})}
                  type="button"
                >
                  {busy ? "Saving..." : "Save & Continue →"}
                </button>
              </>
            ) : null}

            {current.id === "agents" ? (
              <button
                className="rounded-xl border border-accent-blue/45 bg-bg-secondary px-4 py-2 text-xs font-semibold text-text-primary hover:bg-bg-hover disabled:opacity-60"
                disabled={busy}
                onClick={() => next()}
                type="button"
              >
                Continue →
              </button>
            ) : null}

            {current.id === "project" ? (
              <button
                className="rounded-xl border border-accent-green/40 bg-accent-green/10 px-4 py-2 text-xs font-semibold text-accent-green hover:bg-accent-green/15 disabled:opacity-60"
                disabled={busy || projectMode !== "existing" || !pickedPath.trim()}
                onClick={() => launch().catch(() => {})}
                type="button"
              >
                {busy ? "Launching..." : "Launch →"}
              </button>
            ) : null}
          </div>
        </footer>
      </div>
    </div>
  );
}
