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
    <div className="flex items-center gap-3 py-1" data-testid={`pip-${label.toLowerCase()}`}>
      <span className="w-8 text-[10px] uppercase tracking-wider text-cyan-dim">{label}</span>
      <span className="flex flex-1 gap-1" aria-label={`${label} ${String(filled)} of 4`}>
        {Array.from({ length: PIP_MAX }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 flex-1 rounded-sm ${i < filled ? "bg-orange" : "bg-white/[0.06]"}`}
          />
        ))}
      </span>
      <span className="w-4 text-right font-mono text-[11px] text-orange">{String(filled)}</span>
    </div>
  );
}

/** Power distribution pips + the deck's single fuel readout (Command Deck redesign). */
export function FuelPips({
  ship,
  pips,
}: {
  readonly ship: ShipState;
  readonly pips: Pips | undefined;
}): React.JSX.Element {
  return (
    <MfdPanel title="Fuel & Power" className="h-full">
      <div className="flex flex-col">
        <PipRow label="SYS" value={pips?.sys ?? 0} />
        <PipRow label="ENG" value={pips?.eng ?? 0} />
        <PipRow label="WEP" value={pips?.wep ?? 0} />
      </div>
      <div className="mt-2 border-t border-white/5 pt-2">
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
