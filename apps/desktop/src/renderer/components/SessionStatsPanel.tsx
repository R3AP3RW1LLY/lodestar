import type { SessionSummary } from "@lodestar/shared";
import { MfdPanel } from "./MfdPanel.js";
import { Stat } from "./Stat.js";
import { fmtCredits, fmtInt, fmtNum } from "../format.js";

/** A headline rate — the two numbers that tell you if a field is worth mining. */
function RateHero({
  label,
  value,
  unit,
}: {
  readonly label: string;
  readonly value: string;
  readonly unit: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-dim">{label}</p>
      <p className="mt-1 flex items-baseline gap-1">
        <span className="font-display text-2xl leading-none text-orange">{value}</span>
        <span className="text-[10px] uppercase tracking-wider text-cyan-dim">{unit}</span>
      </p>
    </div>
  );
}

/** Live mining-session rates (Command Deck redesign). Null ⇒ no session yet this run. */
export function SessionStatsPanel({
  session,
}: {
  readonly session: SessionSummary | null;
}): React.JSX.Element {
  if (session === null) {
    return (
      <MfdPanel title="Session" className="h-full">
        <p className="text-xs text-signal-skip" data-testid="session-empty">
          no active mining session
        </p>
      </MfdPanel>
    );
  }
  return (
    <MfdPanel title="Session" className="h-full">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] text-cyan-dim">Rates</span>
        <span
          className={`clip-mfd border px-2 py-0.5 font-mono text-[10px] uppercase tracking-widest ${
            session.active
              ? "border-signal-ok/40 text-signal-ok"
              : "border-white/10 text-signal-skip"
          }`}
          data-testid="session-status"
        >
          {session.active ? "active" : "ended"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <RateHero label="Tons / hr" value={fmtNum(session.tonsPerHour, 1)} unit="t/h" />
        <RateHero label="Credits / hr" value={fmtCredits(session.creditsPerHour)} unit="" />
      </div>
      <div className="mt-3 border-t border-white/5 pt-2">
        <Stat label="Tons refined" value={`${fmtInt(session.tonsRefined)} t`} mono />
        <Stat label="Credits earned" value={fmtCredits(session.creditsEarned)} mono />
        <Stat label="Limpets" value={fmtInt(session.limpetsLaunched)} mono />
        {session.bankedToCarrier > 0 && (
          <Stat label="Banked (carrier)" value={fmtCredits(session.bankedToCarrier)} mono />
        )}
      </div>
    </MfdPanel>
  );
}
