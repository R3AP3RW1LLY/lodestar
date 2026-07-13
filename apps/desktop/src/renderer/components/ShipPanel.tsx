import type { ShipState } from "@lodestar/shared";
import { MfdPanel } from "./MfdPanel.js";
import { Stat } from "./Stat.js";
import { fmtInt, fmtNum, fmtText } from "../format.js";

/** Ship identity + loadout summary + fuel (Step 1.10). */
export function ShipPanel({ ship }: { readonly ship: ShipState }): React.JSX.Element {
  return (
    <MfdPanel title="Ship">
      <Stat label="Type" value={fmtText(ship.type)} />
      <Stat label="Name" value={fmtText(ship.name)} />
      <Stat label="Ident" value={fmtText(ship.ident)} mono />
      <Stat
        label="Cargo cap"
        value={ship.cargoCapacity === undefined ? "—" : `${fmtInt(ship.cargoCapacity)} t`}
      />
      <Stat
        label="Jump range"
        value={ship.maxJumpRange === undefined ? "—" : `${fmtNum(ship.maxJumpRange, 2)} ly`}
      />
      <Stat
        label="Fuel"
        value={ship.fuelMain === undefined ? "—" : `${fmtNum(ship.fuelMain, 1)} t`}
        mono
      />
    </MfdPanel>
  );
}
