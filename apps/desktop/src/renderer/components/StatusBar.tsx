import type { AppHealth } from "@lodestar/shared";

export interface StatusBarProps {
  readonly health: AppHealth | null;
  /** True once a previously-good health connection has been lost. */
  readonly connectionLost?: boolean;
}

type ProbeStatus = AppHealth["dbStatus"];

const DOT_CLASSES: Record<ProbeStatus, string> = {
  ok: "bg-signal-ok",
  error: "bg-signal-danger",
  "not-configured": "bg-signal-skip",
};

function Indicator({
  id,
  label,
  status,
}: {
  id: string;
  label: string;
  status: ProbeStatus;
}): React.JSX.Element {
  return (
    <span className="flex items-center gap-1" data-testid={id} data-status={status}>
      <span className={`inline-block h-2 w-2 rounded-full ${DOT_CLASSES[status]}`} aria-hidden />
      <span className="uppercase tracking-widest text-cyan-dim">{label}</span>
      <span className="text-orange">{status}</span>
    </span>
  );
}

/** Bottom status bar: live DB + journal indicators (Ollama joins Phase 5). */
export function StatusBar({ health, connectionLost = false }: StatusBarProps): React.JSX.Element {
  return (
    <footer className="flex items-center gap-4 border-t border-white/10 bg-white/[0.02] px-4 py-1.5 font-mono text-[10px] backdrop-blur-md">
      {connectionLost ? (
        <span data-testid="status-connection" className="text-signal-danger">
          connection lost
        </span>
      ) : health === null ? (
        <span data-testid="status-connection" className="text-cyan-dim">
          connecting…
        </span>
      ) : (
        <>
          <Indicator id="status-db" label="DB" status={health.dbStatus} />
          <Indicator id="status-journal" label="Journal" status={health.journalStatus} />
          <span className="ml-auto text-signal-skip">Polaris v{health.version}</span>
        </>
      )}
    </footer>
  );
}
