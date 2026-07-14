/**
 * Outfitter main-process bridge (SSOT Step 4.15b). Runs the Step-4.15a loadout advisor
 * against the commander's LAST captured `Loadout` (modules + ship, fed from the live engine
 * by `index.ts`). Read-only: it lists gaps, never changes the ship. Ship-slot data isn't
 * sourced yet, so suggestions aren't slot-filtered (flagged); the fit-check turns on once a
 * ship-slot table is wired.
 */

import { analyzeLoadout } from "@lodestar/core";
import type { LoadoutModule } from "@lodestar/core";
import type { MiningMethod, OutfitterAdvice } from "@lodestar/shared";

export interface CapturedLoadout {
  readonly ship: string;
  readonly modules: readonly LoadoutModule[];
}

export interface OutfitterBridge {
  advise: (method: MiningMethod) => OutfitterAdvice;
}

export function createOutfitterBridge(
  getLoadout: () => CapturedLoadout | undefined,
): OutfitterBridge {
  return {
    advise: (method) => {
      const loadout = getLoadout();
      if (loadout === undefined) {
        return {
          method,
          ship: null,
          hasLoadout: false,
          present: [],
          missingRequired: [],
          suggestions: [],
        };
      }
      const advice = analyzeLoadout(loadout.modules, method);
      return {
        method,
        ship: loadout.ship,
        hasLoadout: true,
        present: advice.present,
        missingRequired: advice.missingRequired,
        suggestions: advice.suggestions,
      };
    },
  };
}
