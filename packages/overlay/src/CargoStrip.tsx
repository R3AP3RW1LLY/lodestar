import type { CSSProperties } from "react";
import type { RootState } from "@lodestar/shared";
import { cargoPercent } from "./overlay-state.js";
import { COLORS, GLASS } from "./overlay-theme.js";

const STRIP: CSSProperties = {
  ...GLASS,
  display: "flex",
  flexDirection: "column",
  gap: "0.3rem",
  minWidth: "12rem",
};

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * The cargo HUD (Step 2.10): hold fill against capacity — `count / cap t` with a
 * fill bar and percentage. When capacity is unknown (loadout not yet seen) it shows
 * the raw tonnage and no bar, never a misleading gauge — same rule as the deck.
 */
export function CargoStrip({ state }: { readonly state: RootState }): React.JSX.Element {
  const pct = cargoPercent(state);
  const cap = state.ship.cargoCapacity;
  return (
    <div style={STRIP} data-testid="cargo-strip">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.62rem", letterSpacing: "0.18em", color: COLORS.cyanDim }}>
          CARGO
        </span>
        <span style={{ fontSize: "0.85rem", color: COLORS.orange }} data-testid="cargo-value">
          {fmtInt(state.cargo.count)}
          {cap !== undefined ? ` / ${fmtInt(cap)} t` : " t"}
          {pct !== undefined ? ` · ${String(Math.round(pct))}%` : ""}
        </span>
      </div>
      {pct !== undefined && (
        <div
          style={{
            height: "0.35rem",
            borderRadius: "0.2rem",
            background: "rgba(255,255,255,0.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{ height: "100%", width: `${String(pct)}%`, background: COLORS.orange }}
            data-testid="cargo-fill"
          />
        </div>
      )}
    </div>
  );
}
