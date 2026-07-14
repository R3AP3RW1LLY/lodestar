import type { SessionListItem } from "@lodestar/shared";
import { MfdPanel } from "../MfdPanel.js";
import { Sparkline } from "./charts.js";
import { fmtCredits, fmtInt, fmtNum } from "../../format.js";

function shortDate(iso: string): string {
  return iso.slice(0, 10);
}

/** The session history list (newest first) with a tons/hr sparkline + row drill-down. */
export function SessionTable({
  sessions,
  selectedId,
  onSelect,
}: {
  readonly sessions: readonly SessionListItem[];
  readonly selectedId: number | null;
  readonly onSelect: (id: number) => void;
}): React.JSX.Element {
  // Sparkline reads oldest→newest so the line moves forward in time.
  const spark = [...sessions].reverse().map((s) => s.tonsPerHour);
  return (
    <MfdPanel title="Sessions">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] text-cyan-dim">
          {fmtInt(sessions.length)} shown
        </span>
        <Sparkline values={spark} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" data-testid="session-table">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-cyan-dim">
              <th className="py-1 text-left font-normal">Date</th>
              <th className="text-left font-normal">Ship</th>
              <th className="text-left font-normal">Ring</th>
              <th className="text-right font-normal">Tons</th>
              <th className="text-right font-normal">t/hr</th>
              <th className="text-right font-normal">Credits</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr
                key={s.id}
                onClick={() => {
                  onSelect(s.id);
                }}
                aria-selected={s.id === selectedId}
                data-testid={`session-row-${String(s.id)}`}
                className={`cursor-pointer border-t border-white/5 transition-colors hover:bg-white/[0.04] ${
                  s.id === selectedId ? "bg-orange/10" : ""
                }`}
              >
                <td className="py-1 text-cyan">{shortDate(s.startedAt)}</td>
                <td className="text-cyan">{s.ship ?? "—"}</td>
                <td className="max-w-[12rem] truncate text-cyan">{s.ring ?? "—"}</td>
                <td className="text-right font-mono text-orange">{fmtInt(s.tonsRefined)}</td>
                <td className="text-right font-mono text-orange">{fmtNum(s.tonsPerHour, 1)}</td>
                <td className="text-right font-mono text-orange">{fmtCredits(s.creditsEarned)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MfdPanel>
  );
}
