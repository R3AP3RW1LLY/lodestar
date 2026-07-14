/**
 * Vein Finder main-process bridge (SSOT Step 4.13). Thin adapter over the core vein
 * service: supplies the commander's current origin (from the live location state) and the
 * clock, and forwards the renderer's filter. Distance is null when the location is unknown.
 */

import type { Db } from "@lodestar/data";
import { createVeinService } from "@lodestar/core";
import type { VeinOrigin } from "@lodestar/core";
import type { VeinCandidate, VeinFilter } from "@lodestar/shared";

export interface VeinBridge {
  find: (filter: VeinFilter) => readonly VeinCandidate[];
}

export function createVeinBridge(
  db: Db,
  getOrigin: () => VeinOrigin | undefined,
  now: () => number,
): VeinBridge {
  const service = createVeinService(db, now);
  return { find: (filter) => service.candidates(filter, getOrigin()) };
}

export function emptyVeinBridge(): VeinBridge {
  return { find: () => [] };
}
