import type { Pips, ShipState } from "@lodestar/shared";
import { MfdPanel } from "./MfdPanel.js";
import { Stat } from "./Stat.js";
import { fmtNum } from "../format.js";

const PIP_MAX = 4; // pips are 0..4 per system (already de-halved upstream)

function PipRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}): React.JSX.Element {
  const filled = Math.round(value);
  return (
    <div
      className="flex items-center justify-between gap-3 py-0.5"
      data-testid={`pip-${label.toLowerCase()}`}
    >
      <span className="text-[10px] uppercase tracking-wider text-cyan-dim">{label}</span>
      <span className="flex gap-0.5" aria-label={`${label} ${String(filled)} of 4`}>
        {Array.from({ length: PIP_MAX }, (_, i) => (
          <span key={i} className={`h-3 w-1.5 ${i < filled ? "bg-orange" : "bg-cyan-dim/25"}`} />
        ))}
      </span>
    </div>
  );
}

/** Power distribution pips + fuel readout (Step 1.10). */
export function FuelPips({
  ship,
  pips,
}: {
  readonly ship: ShipState;
  readonly pips: Pips | undefined;
}): React.JSX.Element {
  return (
    <MfdPanel title="Fuel & Pips">
      <PipRow label="SYS" value={pips?.sys ?? 0} />
      <PipRow label="ENG" value={pips?.eng ?? 0} />
      <PipRow label="WEP" value={pips?.wep ?? 0} />
      <div className="mt-2">
        <Stat
          label="Fuel (main)"
          value={ship.fuelMain === undefined ? "—" : `${fmtNum(ship.fuelMain, 2)} t`}
          mono
        />
        <Stat
          label="Reservoir"
          value={ship.fuelReservoir === undefined ? "—" : `${fmtNum(ship.fuelReservoir, 2)} t`}
          mono
        />
      </div>
    </MfdPanel>
  );
}
