import { useCallback, useEffect, useState } from "react";
import type { PlanStrategy, RunPlanView } from "@lodestar/shared";
import { commodityById } from "@lodestar/shared";
import { ScreenHeader } from "../components/ScreenHeader.js";
import { MfdPanel } from "../components/MfdPanel.js";
import { fmtCredits, fmtInt } from "../format.js";

const STRATEGIES: { readonly id: PlanStrategy; readonly label: string }[] = [
  { id: "max-profit", label: "Max Profit" },
  { id: "min-time", label: "Min Time" },
  { id: "safest", label: "Safest" },
];

const displayName = (commodityId: string): string =>
  commodityById(commodityId)?.displayName ?? commodityId;

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${String(h)}h ${String(m)}m` : `${String(m)}m`;
}

/** The ordered plain system waypoints for the player to copy (mine → sell → return). */
export function planWaypoints(plan: RunPlanView): string[] {
  const points = [plan.candidate.systemName, plan.candidate.sellSystem, plan.candidate.systemName];
  return points.filter((name, i) => name !== points[i - 1]); // drop consecutive duplicates
}

/**
 * The Cartographer — round-trip run planner (SSOT Step 4.12c). Pick a strategy (Max
 * Profit / Min Time / Safest) and get ranked plan cards: mine here → sell there → return,
 * with a leg-by-leg breakdown + time/profit estimates. **Copy-to-clipboard writes plain
 * system names** for the player to paste into the galaxy map by hand — LODESTAR never
 * injects a route into the game.
 */
export function Cartographer(): React.JSX.Element {
  const [strategy, setStrategy] = useState<PlanStrategy>("max-profit");
  const [plans, setPlans] = useState<readonly RunPlanView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [copied, setCopied] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    window.lodestar
      .planRuns(strategy)
      .then((p) => {
        if (cancelled) return;
        setPlans(p);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [strategy]);

  const copyRoute = useCallback((plan: RunPlanView, index: number): void => {
    void navigator.clipboard.writeText(planWaypoints(plan).join("\n")).then(
      () => {
        setCopied(index);
      },
      () => undefined,
    );
  }, []);

  const savePlan = useCallback((index: number): void => {
    window.lodestar
      .savePlan(index)
      .then((r) => {
        if (r.runId !== null) setSaved(index);
      })
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-4">
      <ScreenHeader
        eyebrow="Planner"
        title="Cartographer"
        trailing={
          <div className="flex gap-1" role="group" aria-label="strategy">
            {STRATEGIES.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setStrategy(s.id);
                }}
                className={`clip-mfd border px-2 py-0.5 text-[10px] uppercase tracking-widest ${strategy === s.id ? "border-elite-orange text-elite-orange" : "border-cyan-dim/40 text-cyan-dim"}`}
              >
                {s.label}
              </button>
            ))}
          </div>
        }
      />
      {status === "loading" && <MfdPanel title="Cartographer">Planning…</MfdPanel>}
      {status === "error" && (
        <MfdPanel title="Cartographer">
          <p className="p-2 text-signal-danger">Could not build a plan.</p>
        </MfdPanel>
      )}
      {status === "ready" && plans.length === 0 && (
        <MfdPanel title="Cartographer">
          <p className="p-2 text-signal-skip">
            No plannable runs yet — a run needs a scanned hotspot AND a known sell price (dock at a
            market, or let EDSM + EDDN fill the map).
          </p>
        </MfdPanel>
      )}
      {status === "ready" &&
        plans.map((plan, index) => (
          <PlanCard
            key={`${plan.candidate.ringName}-${plan.candidate.sellStation}`}
            plan={plan}
            index={index}
            copied={copied === index}
            saved={saved === index}
            onCopy={copyRoute}
            onSave={savePlan}
          />
        ))}
    </div>
  );
}

function PlanCard({
  plan,
  index,
  copied,
  saved,
  onCopy,
  onSave,
}: {
  readonly plan: RunPlanView;
  readonly index: number;
  readonly copied: boolean;
  readonly saved: boolean;
  readonly onCopy: (plan: RunPlanView, index: number) => void;
  readonly onSave: (index: number) => void;
}): React.JSX.Element {
  const c = plan.candidate;
  return (
    <MfdPanel title={`${displayName(c.commodityId)} — ${c.ringName}`}>
      <div className="grid grid-cols-2 gap-2 p-2 font-mono text-sm md:grid-cols-4">
        <Stat label="cr / hr" value={fmtCredits(plan.estimatedCph)} accent />
        <Stat label="t / hr" value={fmtInt(plan.estimatedTph)} />
        <Stat label="round trip" value={fmtDuration(plan.totalTimeSec)} />
        <Stat label="jumps" value={fmtInt(plan.totalJumps)} />
      </div>
      <div className="px-2 pb-1 text-sm">
        <span className="text-cyan-dim">Mine</span> {c.systemName} →{" "}
        <span className="text-cyan-dim">Sell</span> {c.sellStation}, {c.sellSystem} @{" "}
        <span className="text-elite-orange">{fmtCredits(c.sellPrice)}</span>
      </div>
      <ol className="px-2 pb-2 font-mono text-xs text-cyan-dim">
        {[...c.outboundLegs, ...c.returnLegs].map((leg, i) => (
          <li key={`${leg.from}-${leg.to}-${String(i)}`}>
            {leg.from} → {leg.to} · {fmtInt(leg.jumps)} jumps · {leg.distanceLy.toFixed(1)} ly
          </li>
        ))}
      </ol>
      <div className="flex gap-2 p-2">
        <button
          type="button"
          onClick={() => {
            onCopy(plan, index);
          }}
          className="clip-mfd border border-cyan-dim/60 px-2 py-1 text-xs uppercase tracking-widest text-cyan hover:bg-cyan/10"
        >
          {copied ? "Copied ✓" : "Copy route"}
        </button>
        <button
          type="button"
          onClick={() => {
            onSave(index);
          }}
          className="clip-mfd border border-elite-orange/60 px-2 py-1 text-xs uppercase tracking-widest text-elite-orange hover:bg-elite-orange/10"
        >
          {saved ? "Saved ✓" : "Save plan"}
        </button>
      </div>
    </MfdPanel>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  readonly label: string;
  readonly value: string;
  readonly accent?: boolean;
}): React.JSX.Element {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-cyan-dim">{label}</p>
      <p className={accent === true ? "text-elite-orange" : "text-white"}>{value}</p>
    </div>
  );
}
