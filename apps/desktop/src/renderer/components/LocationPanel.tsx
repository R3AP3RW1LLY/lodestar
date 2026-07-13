import type { LocationState } from "@lodestar/shared";
import { MfdPanel } from "./MfdPanel.js";
import { Stat } from "./Stat.js";
import { fmtText } from "../format.js";

/** Current system / body / ring / docking (Step 1.10). */
export function LocationPanel({
  location,
}: {
  readonly location: LocationState;
}): React.JSX.Element {
  return (
    <MfdPanel title="Location">
      <Stat label="System" value={fmtText(location.system)} />
      <Stat label="Body" value={fmtText(location.body)} />
      <Stat label="Ring" value={fmtText(location.ring)} />
      <Stat label="Docked" value={location.docked ? (location.stationName ?? "yes") : "no"} />
    </MfdPanel>
  );
}
