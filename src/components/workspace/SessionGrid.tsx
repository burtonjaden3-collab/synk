import type { SessionInfo } from "../../lib/types";
import type { InputMode } from "../../lib/keybindings";
import { SessionPane } from "./SessionPane";

function gridForCount(count: number) {
  if (count <= 1) return { cols: 1, rows: 1 };
  if (count === 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  if (count <= 9) return { cols: 3, rows: 3 };
  return { cols: 4, rows: 3 };
}

export function SessionGrid(props: {
  sessions: SessionInfo[];
  mode: InputMode;
  selectedSessionId: number | null;
  activeSessionId: number | null;
  onSelectSession: (sessionId: number) => void;
  onActivateSession: (sessionId: number) => void;
  onExitToNav: (sessionId: number) => void;
  registerOutputHandler: (sessionId: number, handler: (dataB64: string) => void) => void;
  unregisterOutputHandler: (sessionId: number) => void;
  onDestroySession: (sessionId: number) => void | Promise<void>;
}) {
  const sessions = props.sessions;
  const { cols, rows } = gridForCount(sessions.length);

  return (
    <div
      className="grid h-full w-full gap-3"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {sessions.map((s) => (
        <SessionPane
          key={s.sessionId}
          session={s}
          mode={props.mode}
          selected={props.selectedSessionId === s.sessionId}
          active={props.activeSessionId === s.sessionId}
          dimmed={props.mode === "terminal" && props.activeSessionId !== null && props.activeSessionId !== s.sessionId}
          onSelect={() => props.onSelectSession(s.sessionId)}
          onActivate={() => props.onActivateSession(s.sessionId)}
          onExitToNav={() => props.onExitToNav(s.sessionId)}
          registerOutputHandler={props.registerOutputHandler}
          unregisterOutputHandler={props.unregisterOutputHandler}
          onDestroySession={props.onDestroySession}
        />
      ))}
    </div>
  );
}
