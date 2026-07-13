import type { Config } from "tailwindcss";

/**
 * LODESTAR design tokens (SSOT §3.1 + brand kit). Faceted-crystal palette:
 * Elite-orange primary, cyan accent, deep near-black glass. Exact brand hexes
 * (brand/README.md). Consumed by tailwind.config.ts as a preset so tokens live
 * in one place; the glass surfaces + gradients live in theme/tokens.css.
 */
const preset: Omit<Config, "content"> = {
  theme: {
    extend: {
      colors: {
        void: {
          DEFAULT: "#0b0d13",
          900: "#070809",
          800: "#0b0d13",
          700: "#12141d",
          600: "#1c1f2b",
        },
        orange: {
          DEFAULT: "#f5731b", // brand primary
          bright: "#ffa95a", // brand light
          dim: "#973d0f", // brand deep
        },
        cyan: {
          DEFAULT: "#3fddef", // brand accent
          bright: "#7deaf6",
          dim: "#17a2c4", // brand deep
        },
        signal: {
          mine: "#f5731b",
          skip: "#6b7180",
          warn: "#ffcc33",
          danger: "#ff5468",
          ok: "#33dd99",
        },
      },
      fontFamily: {
        display: ['"Orbitron"', '"Rajdhani"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Consolas"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 12px rgba(245,113,27,0.35)",
        "glow-cyan": "0 0 12px rgba(63,221,239,0.35)",
        glass: "0 10px 34px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.06)",
      },
    },
  },
};

export default preset;
