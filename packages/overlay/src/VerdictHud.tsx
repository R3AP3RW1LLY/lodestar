import type { CSSProperties } from "react";
import type { AssayVerdictEvent } from "@lodestar/shared";
import { topMaterial } from "./overlay-state.js";
import { COLORS, GLASS } from "./overlay-theme.js";

const CARD: CSSProperties = {
  ...GLASS,
  display: "flex",
  flexDirection: "column",
  gap: "0.15rem",
  minWidth: "12rem",
};

/**
 * The verdict HUD (Step 2.10): the latest MINE (orange) / SKIP (dim) call with its
 * dominant commodity, read-only. Before the first prospect it shows a quiet idle
 * line so the overlay reads as "armed", never blank-and-broken.
 */
export function VerdictHud({
  verdict,
}: {
  readonly verdict: AssayVerdictEvent | null;
}): React.JSX.Element {
  if (verdict === null) {
    return (
      <div style={CARD} data-testid="verdict-hud">
        <span style={{ color: COLORS.skip, fontSize: "0.7rem", letterSpacing: "0.18em" }}>
          AWAITING PROSPECT
        </span>
      </div>
    );
  }
  const mine = verdict.call === "MINE";
  const top = topMaterial(verdict.materials);
  return (
    <div
      style={{ ...CARD, borderColor: mine ? "rgba(245,113,27,0.55)" : "rgba(255,255,255,0.12)" }}
      data-testid="verdict-hud"
    >
      <span
        style={{
          fontSize: "1.6rem",
          fontWeight: 700,
          letterSpacing: "0.14em",
          color: mine ? COLORS.orange : COLORS.skip,
        }}
        data-testid="verdict-call"
      >
        {verdict.call}
      </span>
      {top !== undefined && (
        <span style={{ fontSize: "0.85rem", color: COLORS.cyan }} data-testid="verdict-top">
          {top.displayName} {String(Math.round(top.proportion))}%
        </span>
      )}
    </div>
  );
}
