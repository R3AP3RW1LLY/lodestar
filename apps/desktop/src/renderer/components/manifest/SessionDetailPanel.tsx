import type { SessionDetail } from "@lodestar/shared";
import { MfdPanel } from "../MfdPanel.js";
import { fmtCredits, fmtInt, fmtNum } from "../../format.js";
import { fmtDuration } from "./panels.js";

/** Drill-down for the selected session: header stats, commodity mix, prospect summary. */
export function SessionDetailPanel({
  detail,
}: {
  readonly detail: SessionDetail | null;
}): React.JSX.Element {
  if (detail === null) {
    return (
      <MfdPanel title="Session detail">
        <p className="text-xs text-signal-skip" data-testid="detail-empty">
          Select a session to see its breakdown.
        </p>
      </MfdPanel>
    );
  }
  const s = detail.session;
  const maxTons = Math.max(1, ...detail.refinements.map((r) => r.tons));
  return (
    <MfdPanel title="Session detail">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs" data-testid="session-detail">
        <span className="text-cyan">{s.startedAt.slice(0, 16).replace("T", " ")}</span>
        <span className="text-cyan">{s.ship ?? "—"}</span>
        <span className="text-cyan">{s.ring ?? "—"}</span>
        <span className="font-mono text-orange">{fmtInt(s.tonsRefined)} t</span>
        <span className="font-mono text-orange">{fmtNum(s.tonsPerHour, 1)} t/hr</span>
        <span className="font-mono text-orange">{fmtCredits(s.creditsEarned)}</span>
        <span className="text-cyan-dim">{fmtDuration(s.durationSec)}</span>
      </div>

      <h3 className="mt-4 mb-1 text-[10px] uppercase tracking-[0.18em] text-cyan-dim">
        Commodity mix
      </h3>
      {detail.refinements.length === 0 ? (
        <p className="text-xs text-signal-skip">No refined tonnage recorded.</p>
      ) : (
        <ul className="flex flex-col gap-1.5" data-testid="detail-mix">
          {detail.refinements.map((r) => (
            <li key={r.commodity} className="flex items-center gap-2 text-xs">
              <span className="w-28 shrink-0 truncate text-cyan">{r.commodity}</span>
              <div className="h-2 flex-1 overflow-hidden rounded bg-void-900">
                <div
                  className="h-full rounded bg-orange/70"
                  style={{ width: `${String(Math.round((r.tons / maxTons) * 100))}%` }}
                />
              </div>
              <span className="w-12 text-right font-mono text-orange">{fmtInt(r.tons)} t</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 border-t border-white/5 pt-3 text-xs">
        <span className="text-cyan-dim">
          Prospected <span className="font-mono text-orange">{fmtInt(detail.prospected)}</span>
        </span>
        <span className="text-cyan-dim">
          MINE <span className="font-mono text-orange">{fmtInt(detail.mineVerdicts)}</span>
        </span>
        <span className="text-cyan-dim">
          Acted on <span className="font-mono text-orange">{fmtInt(detail.actedOn)}</span>
        </span>
        <span className="text-cyan-dim">
          Motherlodes <span className="font-mono text-orange">{fmtInt(detail.motherlodes)}</span>
        </span>
      </div>
    </MfdPanel>
  );
}
