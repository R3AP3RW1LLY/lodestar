/**
 * Outfitter (loadout advisor) IPC DTOs (SSOT Step 4.15b). The advice that crosses IPC to
 * the Loadout Advisor panel: what mining modules are equipped, the missing REQUIRED ones
 * for the chosen method, and slot-fitting recommendations. Mirrors the Step-4.15a
 * `LoadoutAdvice`; the main handler maps to it. Read-only — the advisor NEVER changes the
 * ship (it can't; the game owns outfitting). It only lists gaps.
 */

import type { MiningMethod } from "./commodities.js";

export interface OutfitterModule {
  readonly kind: string;
  readonly label: string;
}

export interface OutfitterGap {
  readonly kind: string;
  readonly label: string;
  readonly category: "hardpoint" | "optional-internal";
  readonly minSize: number;
  readonly reason: string;
  readonly fitsShip: boolean;
}

export interface OutfitterAdvice {
  readonly method: MiningMethod;
  /** The ship type the advice is for (from the last `Loadout`), or null if none seen yet. */
  readonly ship: string | null;
  readonly hasLoadout: boolean;
  readonly present: readonly OutfitterModule[];
  readonly missingRequired: readonly OutfitterGap[];
  readonly suggestions: readonly OutfitterGap[];
}

export interface OutfitterAdviseRequest {
  readonly method: MiningMethod;
}
