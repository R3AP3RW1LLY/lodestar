import type { SessionSummary } from "@lodestar/shared";
import { MfdPanel } from "./MfdPanel.js";
import { Stat } from "./Stat.js";
import { fmtCredits, fmtInt, fmtNum } from "../format.js";

/** Live mining-session rates (Step 1.10). Null ⇒ no session yet this run. */
export function SessionStatsPanel({
  session,
}: {
  readonly session: SessionSummary | null;
}): React.JSX.Element {
  if (session === null) {
    return (
      <MfdPanel title="Session">
        <p className="text-xs text-signal-skip" data-testid="session-empty">
          no active mining session
        </p>
      </MfdPanel>
    );
  }
  return (
    <MfdPanel title="Session">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-cyan-dim">Status</span>
        <span
          className={`font-mono text-xs uppercase ${session.active ? "text-signal-ok" : "text-signal-skip"}`}
          data-testid="session-status"
        >
          {session.active ? "active" : "ended"}
        </span>
      </div>
      <Stat label="Tons refined" value={`${fmtInt(session.tonsRefined)} t`} mono />
      <Stat label="Tons / hr" value={fmtNum(session.tonsPerHour, 1)} mono />
      <Stat label="Credits" value={fmtCredits(session.creditsEarned)} mono />
      <Stat label="Credits / hr" value={fmtCredits(session.creditsPerHour)} mono />
      <Stat label="Limpets" value={fmtInt(session.limpetsLaunched)} mono />
      {session.bankedToCarrier > 0 && (
        <Stat label="Banked (carrier)" value={fmtCredits(session.bankedToCarrier)} mono />
      )}
    </MfdPanel>
  );
}
