/**
 * Overlay window-state persistence (SSOT Step 2.10 arrange). A tiny JSON file in
 * the data dir recording the commander's overlay PLACEMENT (bounds), so the HUD
 * reappears where they left it. Runtime UI state, not domain data — hence a plain
 * file, not a SQLite migration.
 *
 * The LOCK state is deliberately NOT persisted: the overlay always boots LOCKED
 * (click-through) so it can never restart into a state that blocks game clicks; the
 * commander re-enters arrange mode deliberately each session. Best-effort: a
 * missing/corrupt file yields no saved bounds, and a failed write is non-fatal.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { Rectangle } from "electron";

export interface OverlayWindowState {
  readonly bounds?: Rectangle;
}

export interface OverlayStateStore {
  load: () => OverlayWindowState;
  save: (state: OverlayWindowState) => void;
}

function toRectangle(value: unknown): Rectangle | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const r = value as Record<string, unknown>;
  const { x, y, width, height } = r;
  if (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    width > 0 &&
    typeof height === "number" &&
    height > 0
  ) {
    return { x, y, width, height };
  }
  return undefined;
}

export function fileOverlayStateStore(path: string): OverlayStateStore {
  return {
    load(): OverlayWindowState {
      try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        if (typeof parsed === "object" && parsed !== null) {
          const bounds = toRectangle((parsed as Record<string, unknown>)["bounds"]);
          if (bounds !== undefined) return { bounds };
        }
      } catch {
        // Missing or corrupt file → no saved placement.
      }
      return {};
    },
    save(state: OverlayWindowState): void {
      try {
        writeFileSync(path, JSON.stringify(state), "utf8");
      } catch {
        // Best-effort — a dropped write only costs the saved placement next launch.
      }
    },
  };
}
