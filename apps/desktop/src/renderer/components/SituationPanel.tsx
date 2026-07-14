import type { Activity, LocationState, StatusFlags } from "@lodestar/shared";
import { MfdPanel } from "./MfdPanel.js";
import { fmtText } from "../format.js";

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

/** The status-dot colour tracks the activity accent so the glance reads instantly. */
const ACTIVITY_DOT: Record<Activity, string> = {
  unknown: "bg-signal-skip",
  "on-foot": "bg-cyan",
  docked: "bg-cyan",
  supercruise: "bg-cyan",
  mining: "bg-signal-ok shadow-[0_0_10px_rgba(51,221,153,0.6)]",
  traveling: "bg-orange shadow-glow",
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

/**
 * The situation hero (Command Deck redesign): what the commander is doing and
 * where, at a glance. The big activity word (accent-coloured, with a matching
 * status dot), the system + body/ring beneath it, a docked/in-flight marker, and
 * the live status-flag chips. Folds the former Activity + Location tiles into one
 * coherent banner so the deck leads with meaning, not a grid of equal boxes.
 */
export function SituationPanel({
  activity,
  location,
  flags,
}: {
  readonly activity: Activity;
  readonly location: LocationState;
  readonly flags: StatusFlags | undefined;
}): React.JSX.Element {
  const active = FLAG_CHIPS.filter((chip) => flags?.[chip.key] === true);
  // Prefer the ring while mining, else the body; the ring string already carries
  // the system prefix so we never repeat it.
  const place = location.ring ?? location.body;
  return (
    <MfdPanel title="Situation" className="h-full">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${ACTIVITY_DOT[activity]}`}
              aria-hidden
            />
            <span
              className={`truncate font-display text-3xl uppercase tracking-[0.14em] ${ACTIVITY_CLASS[activity]}`}
              data-testid="activity-value"
            >
              {ACTIVITY_LABEL[activity]}
            </span>
          </div>
          <p className="mt-2.5 truncate text-lg text-cyan" data-testid="situation-system">
            {fmtText(location.system)}
          </p>
          {place !== undefined && place !== "" && (
            <p className="truncate text-xs uppercase tracking-[0.16em] text-cyan-dim">{place}</p>
          )}
        </div>
        <span
          className={`clip-mfd shrink-0 border px-2.5 py-1 font-display text-[10px] uppercase tracking-[0.2em] ${
            location.docked ? "border-cyan/40 text-cyan" : "border-white/10 text-signal-skip"
          }`}
          data-testid="situation-dock"
        >
          {location.docked ? (location.stationName ?? "Docked") : "In Flight"}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-1.5" data-testid="situation-flags">
        {active.length === 0 ? (
          <span className="text-xs text-signal-skip">nominal</span>
        ) : (
          active.map((chip) => (
            <span
              key={chip.key}
              className="clip-mfd border border-signal-warn/50 bg-signal-warn/5 px-1.5 py-0.5 font-mono text-[10px] tracking-widest text-signal-warn"
            >
              {chip.label}
            </span>
          ))
        )}
      </div>
    </MfdPanel>
  );
}
