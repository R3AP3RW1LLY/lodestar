import { useEffect } from "react";
import { MfdPanel } from "../components/MfdPanel.js";
import { ScreenHeader } from "../components/ScreenHeader.js";
import { VerdictCard } from "../components/VerdictCard.js";
import { ProspectHistory } from "../components/ProspectHistory.js";
import { useAssayStore } from "../stores/assay.js";
import { subscribeGameState, useGameState } from "../stores/game-state.js";

/**
 * The Assay dashboard (SSOT Step 2.9), on the app-wide deck style: the live
 * MINE/SKIP verdict card leads as the hero, a KPI strip carries the 2.8 prospector
 * stats, and recent-prospect history sits alongside. The verdict feed is app-level
 * (App.tsx) so history survives screen switches; this screen subscribes to
 * game-state for live stats. Same header / container / glass-panel language as the
 * Command Deck so the two screens read as one designed surface.
 */
export function Assay(): React.JSX.Element {
  const latest = useAssayStore((s) => s.latest);
  const history = useAssayStore((s) => s.history);
  const session = useGameState((s) => s.session);
  const stats = session?.prospectStats;
  const assayed = stats !== undefined && stats.prospected > 0;

  useEffect(() => {
    let off = (): void => {};
    try {
      off = subscribeGameState(window.lodestar);
    } catch {
      /* bridge unavailable — the panels still render whatever the store holds */
    }
    return () => {
      off();
    };
  }, []);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-5" data-testid="assay-screen">
      <ScreenHeader
        title="Assay"
        trailing={
          <span className="font-display text-xs uppercase tracking-[0.2em] text-cyan-dim">
            {assayed ? "Session live" : "Standing by"}
          </span>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="hit-rate-strip">
        <Kpi label="Prospected" value={stats !== undefined ? String(stats.prospected) : "0"} />
        <Kpi
          label="Hit rate"
          value={assayed ? `${String(Math.round(stats.hitRate * 100))}%` : "—"}
        />
        <Kpi
          label="Avg best"
          value={assayed ? `${String(Math.round(stats.avgBestMaterialPct))}%` : "—"}
        />
        <Kpi
          label="Motherlodes"
          value={stats !== undefined ? String(stats.motherlodeCount) : "0"}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          {latest === null ? (
            <MfdPanel title="Awaiting prospect" className="h-full">
              <p className="text-sm text-cyan" data-testid="assay-empty">
                Fire a prospector limpet at an asteroid — the mine/skip verdict lands here.
              </p>
            </MfdPanel>
          ) : (
            <VerdictCard verdict={latest} />
          )}
        </div>
        <MfdPanel title="Recent prospects" className="h-full lg:col-span-4">
          <ProspectHistory history={history} />
        </MfdPanel>
      </div>
    </div>
  );
}

/** A KPI tile — glass surface, label over a display-weight value; the deck stat idiom. */
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
