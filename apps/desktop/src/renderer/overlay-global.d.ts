import type { OverlayConnection } from "../overlay-connection.js";

/**
 * The overlay preload exposes the WS connection info under `window.lodestarOverlay`
 * (null when absent). This is the overlay renderer's ONLY bridge — there is no
 * `window.lodestar` (no ipcRenderer) in the overlay, by design (WS-only).
 */
declare global {
  interface Window {
    readonly lodestarOverlay: OverlayConnection | null;
  }
}

export {};
