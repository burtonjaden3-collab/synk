import type { OrchestrationMode } from "../../lib/types";

type OrchestratorControlsProps = {
  value: OrchestrationMode;
  onChange: (mode: OrchestrationMode) => void;
};

export function OrchestratorControls(props: OrchestratorControlsProps) {
  const { value, onChange } = props;

  const Radio = (p: { id: OrchestrationMode; label: string; disabled?: boolean }) => (
    <label
      className={[
        "flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-bg-secondary px-2 py-2 text-xs",
        p.disabled ? "opacity-60" : "hover:bg-bg-hover",
      ].join(" ")}
    >
      <input
        type="radio"
        name="orchestrationMode"
        checked={value === p.id}
        onChange={() => onChange(p.id)}
        disabled={p.disabled}
      />
      <span className="text-text-primary">{p.label}</span>
    </label>
  );

  return (
    <div className="space-y-2">
      <Radio id="gastown" label="Gastown" />
      <Radio id="agent_teams" label="Agent Teams" disabled />
      <Radio id="manual" label="Manual" />
      <div className="text-[10px] text-text-secondary">UI only (persistence comes later).</div>
    </div>
  );
}

