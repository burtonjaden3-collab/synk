type StatCardProps = {
  label: string;
  value: string;
  hint?: string;
};

function StatCard(props: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border bg-bg-tertiary p-4 shadow-[0_18px_55px_rgba(0,0,0,0.35)]">
      <div className="pointer-events-none absolute -right-24 -top-24 h-48 w-48 rounded-full bg-accent-blue/10 blur-2xl transition-transform duration-700 group-hover:rotate-12" />
      <div className="text-[11px] font-semibold tracking-[0.16em] text-text-secondary">
        {props.label.toUpperCase()}
      </div>
      <div className="mt-2 font-mono text-[28px] font-semibold tracking-tight text-text-primary">
        {props.value}
      </div>
      {props.hint ? (
        <div className="mt-1 text-xs text-text-secondary">{props.hint}</div>
      ) : null}
    </div>
  );
}

export function DashboardStats() {
  // Placeholder values (Task 1.6) — real aggregation arrives in later phases.
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Total Sessions" value="-" hint="Coming soon" />
      <StatCard label="Total Cost" value="-" hint="Coming soon" />
      <StatCard label="Tasks Completed" value="-" hint="Coming soon" />
      <StatCard label="Hours Saved" value="-" hint="Coming soon" />
    </div>
  );
}

