import type { RecentProject } from "../../lib/types";

type ProjectSelectorProps = {
  tauriAvailable: boolean;
  currentProject: RecentProject | null;
  recentProjects: RecentProject[];
  onOpenFolder: () => void;
  onSelectProject: (projectPath: string) => void;
};

export function ProjectSelector(props: ProjectSelectorProps) {
  const { tauriAvailable, currentProject, recentProjects, onOpenFolder, onSelectProject } = props;

  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-text-primary">
            {currentProject?.name ?? "No project"}
          </div>
          <div className="truncate font-mono text-[10px] text-text-secondary">
            {currentProject?.path ?? "(none)"}
          </div>
        </div>

        <button
          className="rounded-lg border border-border bg-bg-tertiary px-2.5 py-2 text-[11px] font-medium text-text-secondary hover:bg-bg-hover disabled:opacity-60"
          disabled={!tauriAvailable}
          onClick={onOpenFolder}
          title="Open folder"
          type="button"
        >
          Open
        </button>
      </div>

      <div className="mt-2">
        <label className="block text-[10px] font-semibold tracking-[0.14em] text-text-secondary">
          SWITCH
        </label>
        <select
          className="mt-1 h-9 w-full rounded-lg border border-border bg-bg-tertiary px-2 text-xs text-text-primary disabled:opacity-60"
          disabled={!tauriAvailable || recentProjects.length === 0}
          value={currentProject?.path ?? ""}
          onChange={(e) => {
            const next = e.target.value;
            if (next) onSelectProject(next);
          }}
        >
          {currentProject ? null : <option value="">(select)</option>}
          {recentProjects.map((p) => (
            <option key={p.path} value={p.path}>
              {p.name}
            </option>
          ))}
        </select>
        <div className="mt-1 text-[10px] text-text-secondary">
          Uses `~/.config/synk/projects.json`
        </div>
      </div>
    </div>
  );
}

