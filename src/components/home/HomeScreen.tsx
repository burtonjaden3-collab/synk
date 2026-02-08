import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";

import type { RecentProject } from "../../lib/types";
import { persistenceListRecentProjects, persistenceOpenProject } from "../../lib/tauri-api";
import { useAppStore } from "../../lib/store";
import { DashboardStats } from "./DashboardStats";

function isTauriRuntime(): boolean {
  const w = globalThis as unknown as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return !!(w.__TAURI__ || w.__TAURI_INTERNALS__);
}

function baseName(path: string): string {
  // Keep it OS-agnostic; the backend treats paths as strings too.
  const parts = path.split(/[\\/]/g).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function relativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const deltaMs = Date.now() - t;
  const mins = Math.round(deltaMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function HomeScreen() {
  const setCurrentProject = useAppStore((s) => s.setCurrentProject);

  const tauriAvailable = useMemo(() => isTauriRuntime(), []);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshRecent = async () => {
    if (!tauriAvailable) return;
    const list = await persistenceListRecentProjects();
    setRecentProjects(list);
  };

  useEffect(() => {
    refreshRecent().catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauriAvailable]);

  const openProject = async (path: string) => {
    setError(null);
    setBusy(true);
    try {
      const proj = await persistenceOpenProject(path);
      setCurrentProject(proj);
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="relative h-full min-h-full bg-bg-primary text-text-primary">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-accent-blue/12 blur-3xl" />
        <div className="absolute -bottom-28 -right-28 h-[520px] w-[520px] rounded-full bg-accent-green/10 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.08) 0, rgba(255,255,255,0.08) 1px, transparent 1px, transparent 6px)",
          }}
        />
      </div>

      <div className="relative mx-auto flex h-full max-w-6xl flex-col px-5 py-10">
        <header className="flex items-end justify-between gap-4">
          <div>
            <div className="font-mono text-[12px] font-semibold tracking-[0.22em] text-text-secondary">
              WORKSPACE ORCHESTRATOR
            </div>
            <div className="mt-2 flex items-baseline gap-3">
              <div className="text-4xl font-semibold tracking-tight">Synk</div>
              <div className="hidden text-sm text-text-secondary sm:block">
                pick a project and spin up sessions
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <div className="rounded-full border border-border bg-bg-secondary px-3 py-1 text-[11px] font-semibold tracking-wide text-text-secondary">
              Phase 1
            </div>
          </div>
        </header>

        {error ? (
          <div className="mt-6 rounded-xl border border-accent-red/40 bg-bg-tertiary px-4 py-3 text-sm text-accent-red">
            {error}
          </div>
        ) : null}

        {!tauriAvailable ? (
          <div className="mt-6 rounded-xl border border-border bg-bg-tertiary px-4 py-3 text-sm text-text-secondary">
            Browser preview mode: run `npm run tauri dev` to enable folder picker and recent projects.
          </div>
        ) : null}

        <main className="mt-8 grid flex-1 grid-cols-1 gap-4 md:grid-cols-12">
          <section className="md:col-span-5">
            <div className="rounded-3xl border border-border bg-bg-secondary p-4 shadow-[0_26px_70px_rgba(0,0,0,0.45)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Start</div>
                  <div className="mt-1 text-xs text-text-secondary">
                    Create something new, or open an existing folder.
                  </div>
                </div>
                <div className="rounded-full border border-border bg-bg-primary px-2.5 py-1 font-mono text-[11px] text-text-secondary">
                  `~/.config/synk/projects.json`
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  className="group relative overflow-hidden rounded-2xl border border-border bg-bg-tertiary p-4 text-left disabled:opacity-60"
                  disabled
                  title="Wizard ships in later phases"
                >
                  <div className="pointer-events-none absolute -right-24 -top-24 h-44 w-44 rounded-full bg-accent-purple/10 blur-2xl transition-transform duration-700 group-hover:rotate-12" />
                  <div className="text-xs font-semibold text-text-primary">+ New Project</div>
                  <div className="mt-1 text-xs text-text-secondary">
                    Brainstorm wizard (coming soon)
                  </div>
                </button>

                <button
                  className="group relative overflow-hidden rounded-2xl border border-accent-blue/35 bg-bg-tertiary p-4 text-left shadow-[0_18px_45px_rgba(88,166,255,0.10)] disabled:opacity-60"
                  disabled={!tauriAvailable || busy}
                  onClick={async () => {
                    setError(null);
                    setBusy(true);
                    try {
                      const picked = await open({
                        directory: true,
                        multiple: false,
                        title: "Open Folder",
                      });
                      if (!picked) {
                        setBusy(false);
                        return;
                      }
                      const path = Array.isArray(picked) ? picked[0] : picked;
                      if (!path) {
                        setBusy(false);
                        return;
                      }
                      await openProject(path);
                    } catch (e) {
                      setError(String(e));
                      setBusy(false);
                    }
                  }}
                >
                  <div className="pointer-events-none absolute -right-24 -top-24 h-44 w-44 rounded-full bg-accent-blue/16 blur-2xl transition-transform duration-700 group-hover:rotate-12" />
                  <div className="text-xs font-semibold text-text-primary">Open Folder</div>
                  <div className="mt-1 text-xs text-text-secondary">
                    Creates `.synk/` and enters workspace
                  </div>
                  <div className="mt-3 font-mono text-[11px] text-text-secondary">
                    {busy ? "working..." : `cd ${baseName(recentProjects[0]?.path ?? "your-project")}`}
                  </div>
                </button>
              </div>

              <div className="mt-4">
                <div className="text-sm font-semibold">Dashboard</div>
                <div className="mt-3">
                  <DashboardStats />
                </div>
              </div>
            </div>
          </section>

          <section className="md:col-span-7">
            <div className="rounded-3xl border border-border bg-bg-secondary p-4 shadow-[0_26px_70px_rgba(0,0,0,0.45)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Recent Projects</div>
                  <div className="mt-1 text-xs text-text-secondary">
                    Jump back in with one click.
                  </div>
                </div>
                <button
                  className="rounded-lg border border-border bg-bg-primary px-3 py-2 text-xs font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60"
                  disabled={!tauriAvailable || busy}
                  onClick={async () => {
                    setError(null);
                    try {
                      await refreshRecent();
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Refresh
                </button>
              </div>

              <div className="mt-4">
                {recentProjects.length === 0 ? (
                  <div className="rounded-2xl border border-border bg-bg-tertiary px-4 py-10 text-center">
                    <div className="text-sm font-semibold">No recent projects</div>
                    <div className="mt-2 text-xs text-text-secondary">
                      Use Open Folder to add your first project.
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-3">
                    {recentProjects.map((p) => (
                      <button
                        key={p.path}
                        className="group flex items-center gap-4 rounded-2xl border border-border bg-bg-tertiary px-4 py-3 text-left hover:border-accent-blue/40 hover:bg-bg-hover disabled:opacity-60"
                        disabled={!tauriAvailable || busy}
                        onClick={() => openProject(p.path)}
                      >
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-bg-primary font-mono text-xs text-text-secondary">
                          {p.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <div className="truncate text-sm font-semibold text-text-primary">
                              {p.name}
                            </div>
                            <div className="rounded-full border border-border bg-bg-primary px-2 py-0.5 font-mono text-[10px] text-text-secondary">
                              {p.orchestrationMode}
                            </div>
                          </div>
                          <div className="mt-0.5 truncate font-mono text-[11px] text-text-secondary">
                            {p.path}
                          </div>
                        </div>
                        <div className="shrink-0 text-xs text-text-secondary">
                          {relativeTime(p.lastOpened)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

