import type { ReactNode } from "react";
import type { ShipState } from "@lodestar/shared";
import { MfdPanel } from "./MfdPanel.js";
import { fmtInt, fmtNum, fmtText } from "../format.js";

/** One inline label/value pair — the reference strip's atom. */
function InlineStat({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-[10px] uppercase tracking-wider text-cyan-dim">{label}</span>
      <span className={`text-sm text-orange ${mono === true ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

/**
 * Vessel reference strip (Command Deck redesign). Ship identity + capability is the
 * least dynamic information on the deck, so it sits at the foot as a slim inline
 * row rather than a full tile — present when you want it, quiet otherwise. Fuel now
 * lives solely in Fuel & Power, so there is no duplicated (and previously
 * differently-rounded) fuel readout anywhere on the deck.
 */
export function VesselStrip({ ship }: { readonly ship: ShipState }): React.JSX.Element {
  return (
    <MfdPanel title="Vessel">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <InlineStat label="Type" value={fmtText(ship.type)} />
        <InlineStat label="Name" value={fmtText(ship.name)} />
        <InlineStat label="Ident" value={fmtText(ship.ident)} mono />
        <InlineStat
          label="Cargo cap"
          value={ship.cargoCapacity === undefined ? "—" : `${fmtInt(ship.cargoCapacity)} t`}
        />
        <InlineStat
          label="Jump range"
          value={ship.maxJumpRange === undefined ? "—" : `${fmtNum(ship.maxJumpRange, 2)} ly`}
        />
      </div>
    </MfdPanel>
  );
}
