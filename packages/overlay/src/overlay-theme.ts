import type { CSSProperties } from "react";

/**
 * The overlay's brand palette + glass surface as inline styles. The overlay is a
 * separate, self-contained renderer (no Tailwind), so its look lives here rather
 * than in the app's theme — kept in sync with the LODESTAR brand hexes.
 */
export const COLORS = {
  orange: "#f5731b",
  cyan: "#3fddef",
  cyanDim: "#17a2c4",
  skip: "#9aa2b1",
} as const;

/** A semi-opaque near-black panel so the HUD stays legible over any game scene. */
export const GLASS: CSSProperties = {
  background: "rgba(9,11,16,0.72)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "0.6rem",
  padding: "0.5rem 0.7rem",
  backdropFilter: "blur(6px)",
  boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
};
