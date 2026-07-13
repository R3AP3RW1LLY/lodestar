import type { Activity, StatusFlags } from "@lodestar/shared";
import { MfdPanel } from "./MfdPanel.js";

const ACTIVITY_LABEL: Record<Activity, string> = {
  unknown: "Unknown",
  "on-foot": "On Foot",
  docked: "Docked",
  supercruise: "Supercruise",
  mining: "Mining",
  traveling: "Traveling",
};

const ACTIVITY_CLASS: Record<Activity, string> = {
  unknown: "text-signal-skip",
  "on-foot": "text-cyan",
  docked: "text-cyan",
  supercruise: "text-cyan",
  mining: "text-signal-ok",
  traveling: "text-orange",
};

/** The status flags worth surfacing at a glance on the Command Deck. */
const FLAG_CHIPS: readonly { readonly key: keyof StatusFlags; readonly label: string }[] = [
  { key: "hardpointsDeployed", label: "HARDPOINTS" },
  { key: "cargoScoopDeployed", label: "SCOOP" },
  { key: "flightAssistOff", label: "FA-OFF" },
  { key: "fsdMassLocked", label: "MASS-LOCK" },
  { key: "lowFuel", label: "LOW FUEL" },
  { key: "inDanger", label: "DANGER" },
];

/** Derived activity + a few live status flags (Step 1.10). */
export function ActivityPanel({
  activity,
  flags,
}: {
  readonly activity: Activity;
  readonly flags: StatusFlags | undefined;
}): React.JSX.Element {
  const active = FLAG_CHIPS.filter((chip) => flags?.[chip.key] === true);
  return (
    <MfdPanel title="Activity">
      <p
        className={`font-display text-lg uppercase tracking-[0.2em] ${ACTIVITY_CLASS[activity]}`}
        data-testid="activity-value"
      >
        {ACTIVITY_LABEL[activity]}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        {active.length === 0 ? (
          <span className="text-xs text-signal-skip">nominal</span>
        ) : (
          active.map((chip) => (
            <span
              key={chip.key}
              className="clip-mfd border border-signal-warn/50 px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-signal-warn"
            >
              {chip.label}
            </span>
          ))
        )}
      </div>
    </MfdPanel>
  );
}
