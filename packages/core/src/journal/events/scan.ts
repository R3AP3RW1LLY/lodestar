/**
 * Scan ring interpreter (SSOT Step 4.3, pure). A body `Scan` is the ONLY journal source
 * of a ring's type (`RingClass`) and reserve level (`ReserveLevel`) — the scoring inputs.
 * Normalizes the game's `eRingClass_…` enum (tolerating its `Metalic` misspelling) to
 * `Icy | Rocky | Metallic | MetalRich` and `…Resources` to `Pristine | … | Depleted`.
 * Stellar belts (named "… A Belt") are dropped — only true planetary rings are kept.
 */

import type { ScanEvent } from "@lodestar/shared";
import { ringBodyName } from "./saa-signals.js";

const RING_CLASS_PREFIX = "eRingClass_";

/** Normalize a journal `RingClass` to `Icy | Rocky | Metallic | MetalRich`. */
export function normalizeRingClass(ringClass: string): string {
  const bare = ringClass.startsWith(RING_CLASS_PREFIX)
    ? ringClass.slice(RING_CLASS_PREFIX.length)
    : ringClass;
  // The game ships "Metalic" (one 'l'); fold both spellings to the correct one.
  return bare === "Metalic" || bare === "Metallic" ? "Metallic" : bare;
}

/** Normalize a journal `ReserveLevel` ("PristineResources") to `Pristine | … | Depleted`. */
export function normalizeReserveLevel(reserveLevel: string): string {
  return reserveLevel.replace(/Resources$/, "");
}

export interface ScannedRing {
  readonly ringName: string;
  readonly ringType: string;
  readonly reserve?: string;
}

export interface RingScan {
  readonly bodyName: string;
  readonly rings: readonly ScannedRing[];
}

/**
 * Interpret a `Scan` event's ring data. Returns `undefined` when the body has no true
 * rings (no `Rings`, or only stellar belts).
 */
export function interpretRingScan(event: ScanEvent): RingScan | undefined {
  if (event.rings === undefined || event.rings.length === 0) return undefined;
  const reserve =
    event.reserveLevel === undefined ? undefined : normalizeReserveLevel(event.reserveLevel);
  const rings: ScannedRing[] = [];
  for (const ring of event.rings) {
    if (ringBodyName(ring.name) === undefined) continue; // a belt, not a ring
    rings.push({
      ringName: ring.name,
      ringType: normalizeRingClass(ring.ringClass),
      ...(reserve === undefined ? {} : { reserve }),
    });
  }
  if (rings.length === 0) return undefined;
  return { bodyName: event.bodyName, rings };
}
