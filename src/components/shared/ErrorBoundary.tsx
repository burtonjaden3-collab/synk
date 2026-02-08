import type { ReactNode } from "react";
import { Component } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("UI crash:", error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center bg-bg-primary p-6 text-text-primary">
        <div className="w-full max-w-3xl rounded-2xl border border-accent-red/40 bg-bg-secondary p-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
          <div className="text-xs font-semibold tracking-[0.18em] text-accent-red">REACT ERROR</div>
          <div className="mt-2 font-mono text-[12px] text-text-primary">{error.name}: {error.message}</div>
          <div className="mt-3 rounded-xl border border-border bg-bg-tertiary p-3 font-mono text-[11px] text-text-secondary whitespace-pre-wrap">
            {error.stack ?? "(no stack)"}
          </div>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              className="rounded-xl border border-border bg-bg-primary px-3 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-hover hover:text-text-primary"
              onClick={() => this.setState({ error: null })}
              title="Try re-rendering"
            >
              Dismiss
            </button>
            <button
              type="button"
              className="rounded-xl border border-accent-red/45 bg-accent-red/10 px-3 py-2 text-xs font-semibold text-accent-red hover:bg-accent-red/15"
              onClick={() => window.location.reload()}
              title="Reload the UI"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}

