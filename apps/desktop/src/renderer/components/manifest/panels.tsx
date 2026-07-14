import type {
  BestCategory,
  Breakdowns,
  PersonalBest,
  SessionAggregates,
  SessionEfficiency,
} from "@lodestar/shared";
import { MfdPanel } from "../MfdPanel.js";
import { fmtCredits, fmtInt, fmtNum } from "../../format.js";

/** Human-readable duration from seconds ("2h 05m", "45m", "30s"). */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${String(h)}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${String(m)}m`;
  return `${String(s)}s`;
}

function Kpi({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <div className="glass rounded-xl px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-cyan-dim">{label}</p>
      <p className="mt-1 font-display text-2xl text-orange">{value}</p>
    </div>
  );
}

/** The headline totals over the filtered history. */
export function ManifestKpis({
  aggregate,
}: {
  readonly aggregate: SessionAggregates;
}): React.JSX.Element {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
      data-testid="manifest-kpis"
    >
      <Kpi label="Sessions" value={fmtInt(aggregate.sessions)} />
      <Kpi label="Tons refined" value={`${fmtInt(aggregate.tonsRefined)} t`} />
      <Kpi label="Credits" value={fmtCredits(aggregate.creditsEarned)} />
      <Kpi label="Avg t/hr" value={fmtNum(aggregate.avgTonsPerHour, 1)} />
      <Kpi label="Avg cr/hr" value={fmtCredits(aggregate.avgCreditsPerHour)} />
      <Kpi
        label="Hit rate"
        value={aggregate.prospected > 0 ? `${String(Math.round(aggregate.hitRate * 100))}%` : "—"}
      />
    </div>
  );
}

const BEST_LABEL: Record<BestCategory, string> = {
  tons_per_hour: "Best tons/hr",
  credits_per_hour: "Best credits/hr",
  single_rock_value: "Best single rock",
  longest_session: "Longest session",
  most_tons: "Most tons (session)",
};

function bestValue(best: PersonalBest): string {
  switch (best.category) {
    case "tons_per_hour":
      return `${fmtNum(best.value, 1)} t/hr`;
    case "most_tons":
      return `${fmtInt(best.value)} t`;
    case "credits_per_hour":
    case "single_rock_value":
      return fmtCredits(best.value);
    case "longest_session":
      return fmtDuration(best.value);
  }
}

/** The personal-best board (records + the ship/ring/date that set them). */
export function PersonalBestsBoard({
  bests,
}: {
  readonly bests: readonly PersonalBest[];
}): React.JSX.Element {
  return (
    <MfdPanel title="Personal bests">
      {bests.length === 0 ? (
        <p className="text-xs text-signal-skip" data-testid="bests-empty">
          Records appear as you complete sessions.
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="bests-list">
          {bests.map((b) => (
            <li key={b.category} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-cyan-dim">{BEST_LABEL[b.category]}</span>
              <span className="text-right">
                <span className="font-mono text-orange">{bestValue(b)}</span>
                {b.ship !== null && <span className="ml-2 text-xs text-cyan">{b.ship}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </MfdPanel>
  );
}

function BreakdownTable({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: Breakdowns["byRing"];
}): React.JSX.Element {
  return (
    <div>
      <h3 className="mb-1 text-[10px] uppercase tracking-[0.18em] text-cyan-dim">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-signal-skip">—</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.slice(0, 6).map((r) => (
            <li key={r.key} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-cyan">{r.key}</span>
              <span className="font-mono text-orange">
                {fmtInt(r.tonsRefined)} t · {fmtNum(r.tonsPerHour, 1)} t/hr
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** By-ring / by-commodity / by-ship breakdowns + the best (ring × commodity) pairings. */
export function BreakdownsPanel({
  breakdowns,
}: {
  readonly breakdowns: Breakdowns;
}): React.JSX.Element {
  return (
    <MfdPanel title="Breakdowns">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="breakdowns">
        <BreakdownTable title="By ring" rows={breakdowns.byRing} />
        <BreakdownTable title="By commodity" rows={breakdowns.byCommodity} />
        <BreakdownTable title="By ship" rows={breakdowns.byShip} />
      </div>
      <div className="mt-4 border-t border-white/5 pt-3">
        <h3 className="mb-1 text-[10px] uppercase tracking-[0.18em] text-cyan-dim">
          Best pairings
        </h3>
        {breakdowns.bestPairings.length === 0 ? (
          <p className="text-xs text-signal-skip">—</p>
        ) : (
          <ul className="flex flex-col gap-1" data-testid="pairings">
            {breakdowns.bestPairings.slice(0, 5).map((p) => (
              <li
                key={`${p.ring} ${p.commodity}`}
                className="flex items-baseline justify-between gap-2 text-xs"
              >
                <span className="truncate text-cyan">
                  {p.commodity} @ {p.ring}
                </span>
                <span className="font-mono text-orange">{fmtNum(p.tonsPerHour, 1)} t/hr</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </MfdPanel>
  );
}

/** Limpet efficiency + mining/other time split totals (honest launched-only counts). */
export function EfficiencyPanel({
  efficiency,
}: {
  readonly efficiency: SessionEfficiency;
}): React.JSX.Element {
  const l = efficiency.limpets.totals;
  const t = efficiency.timeSplit.totals;
  return (
    <MfdPanel title="Efficiency">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="efficiency">
        <div>
          <h3 className="mb-1 text-[10px] uppercase tracking-[0.18em] text-cyan-dim">Limpets</h3>
          <dl className="flex flex-col gap-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-cyan">Prospector launched</dt>
              <dd className="font-mono text-orange">{fmtInt(l.prospectorLimpets)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-cyan">Collection launched</dt>
              <dd className="font-mono text-orange">{fmtInt(l.collectionLimpets)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-cyan">Collector productivity</dt>
              <dd className="font-mono text-orange">
                {fmtNum(l.collectorProductivity, 2)} t/limpet
              </dd>
            </div>
          </dl>
        </div>
        <div>
          <h3 className="mb-1 text-[10px] uppercase tracking-[0.18em] text-cyan-dim">Time split</h3>
          <dl className="flex flex-col gap-1 text-xs">
            <div className="flex justify-between">
              <dt className="text-cyan">Mining</dt>
              <dd className="font-mono text-orange">{fmtDuration(t.miningSec)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-cyan">Other (travel/sell)</dt>
              <dd className="font-mono text-orange">{fmtDuration(t.otherSec)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-cyan">Mining share</dt>
              <dd className="font-mono text-orange" data-testid="mining-share">
                {String(Math.round(t.miningRatio * 100))}%
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </MfdPanel>
  );
}
