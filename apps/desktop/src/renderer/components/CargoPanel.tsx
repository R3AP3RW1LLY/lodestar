import type { CargoState } from "@lodestar/shared";
import { MfdPanel } from "./MfdPanel.js";
import { fmtInt } from "../format.js";

/** Cargo manifest (limpets already excluded upstream) with the total (Step 1.10). */
export function CargoPanel({ cargo }: { readonly cargo: CargoState }): React.JSX.Element {
  return (
    <MfdPanel title="Cargo">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-cyan-dim">Total</span>
        <span className="font-mono text-sm text-orange">{fmtInt(cargo.count)} t</span>
      </div>
      {cargo.items.length === 0 ? (
        <p className="text-xs text-signal-skip">hold empty</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {cargo.items.map((item) => (
            <li key={item.name} className="flex items-baseline justify-between gap-3">
              <span className="text-xs capitalize text-cyan">{item.name}</span>
              <span className="font-mono text-xs text-orange">{fmtInt(item.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </MfdPanel>
  );
}
