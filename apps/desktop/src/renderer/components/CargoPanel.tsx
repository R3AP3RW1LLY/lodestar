import type { CargoState } from "@lodestar/shared";
import { MfdPanel } from "./MfdPanel.js";
import { fmtInt } from "../format.js";

/**
 * Cargo hold (Command Deck redesign). Leads with the single most glanceable
 * mining number — hold fill against capacity, count / cap t with a fill bar and
 * percentage — then the manifest (limpets already excluded upstream). Capacity
 * comes from the ship loadout; when it's unknown the bar is omitted and only the
 * raw tonnage shows, never a misleading fill.
 */
export function CargoPanel({
  cargo,
  capacity,
}: {
  readonly cargo: CargoState;
  readonly capacity: number | undefined;
}): React.JSX.Element {
  const pct =
    capacity !== undefined && capacity > 0
      ? Math.min(100, Math.max(0, (cargo.count / capacity) * 100))
      : undefined;
  return (
    <MfdPanel title="Cargo Hold" className="h-full">
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-3xl text-orange">{fmtInt(cargo.count)}</span>
          <span className="text-sm text-cyan-dim">
            / {capacity === undefined ? "—" : fmtInt(capacity)} t
          </span>
        </div>
        {pct !== undefined && (
          <span className="font-mono text-sm text-cyan" data-testid="cargo-pct">
            {String(Math.round(pct))}%
          </span>
        )}
      </div>
      {pct !== undefined && (
        <div className="mt-2 h-2 overflow-hidden rounded bg-void-900">
          <div
            className="h-full rounded bg-gradient-to-r from-orange/60 to-orange transition-[width] duration-300"
            style={{ width: `${String(pct)}%` }}
            data-testid="cargo-fill"
          />
        </div>
      )}

      {cargo.items.length === 0 ? (
        <p className="mt-3 text-xs text-signal-skip">hold empty</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1 border-t border-white/5 pt-3">
          {cargo.items.map((item) => (
            <li key={item.name} className="flex items-baseline justify-between gap-3">
              <span className="truncate text-xs capitalize text-cyan">{item.name}</span>
              <span className="font-mono text-xs text-orange">{fmtInt(item.count)} t</span>
            </li>
          ))}
        </ul>
      )}
    </MfdPanel>
  );
}
