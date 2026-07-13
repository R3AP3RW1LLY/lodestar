/**
 * Prospect observation (SSOT Step 2.1). Shapes a parsed `ProspectedAsteroid`
 * event (§5.1, Step 1.5) into the persistable/assayable form the prospects
 * table + Assay engine consume. Full fidelity: every material proportion, the
 * content tier, motherlode, and remaining %. Journals carry NO asteroid identity,
 * so a Prospect is always an INDEPENDENT observation — never a "same rock" claim.
 */

import type { ProspectedAsteroidEvent } from "@lodestar/shared";

export interface ProspectMaterial {
  readonly name: string;
  /** Percentage of the rock's composition (0–100), as reported by the game. */
  readonly proportion: number;
}

export interface Prospect {
  readonly timestamp: string;
  /** Raw content-tier symbol, e.g. "$AsteroidMaterialContent_High;". */
  readonly content: string;
  /** Remaining %, 0–100. A partially-depleted rock reports < 100. */
  readonly remainingPct: number;
  /** The motherlode material's raw name, if this rock has one. */
  readonly motherlode?: string;
  readonly materials: readonly ProspectMaterial[];
  /** A deep-core crack was observed after this prospect (temporal linkage, 1.9a). */
  readonly cracked: boolean;
}

/** Map a parsed `ProspectedAsteroid` event to a Prospect observation. */
export function toProspect(event: ProspectedAsteroidEvent): Prospect {
  return {
    timestamp: event.timestamp,
    content: event.content,
    remainingPct: event.remaining,
    ...(event.motherlodeMaterial !== undefined ? { motherlode: event.motherlodeMaterial } : {}),
    materials: event.materials.map((m) => ({ name: m.name, proportion: m.proportion })),
    cracked: false,
  };
}
