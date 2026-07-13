/**
 * Assay wiring (SSOT Step 2.7b-ii, completes 2.6's deferred engine→bus link). Maps
 * the live engine's parsed journal events onto the Assay `EventBus`, constructs the
 * orchestrator (which saves the prospect, runs the pure verdict engine with the
 * live price book, persists the verdict + acted-on flag), and forwards each verdict
 * to the TTS service. `MarketSell` feeds the price book; `MiningRefined`/
 * `AsteroidCracked` drive the acted-on correlation. Mining method defaults to laser
 * until loadout-inference lands (a later step).
 */

import { commodityFromInternal } from "@lodestar/shared";
import type { Logger, MiningMethod } from "@lodestar/shared";
import {
  EventBus,
  createAssayOrchestrator,
  createPriceBookStore,
  createProspectRepository,
  createThresholdOverridesStore,
  toProspect,
} from "@lodestar/core";
import type { AssayEvents, AssayVerdict, LiveEngine } from "@lodestar/core";
import type { Db } from "@lodestar/data";

export interface AssayWiringDeps {
  readonly engine: LiveEngine;
  readonly db: Db;
  /** Forwarded each verdict (the TTS service's `onVerdict`). */
  readonly onVerdict: (verdict: AssayVerdict) => void;
  readonly logger: Logger;
  /** Current mining method; defaults to "laser" until loadout inference exists. */
  readonly method?: () => MiningMethod;
}

export interface AssayWiring {
  dispose: () => void;
}

export function wireAssay(deps: AssayWiringDeps): AssayWiring {
  const bus = new EventBus<AssayEvents>();
  const priceBook = createPriceBookStore(deps.db);
  const orchestrator = createAssayOrchestrator({
    bus,
    prospects: createProspectRepository(deps.db),
    overrides: createThresholdOverridesStore(deps.db),
    priceBook: priceBook.resolver(),
    speak: deps.onVerdict,
    logger: deps.logger,
  });
  const method = deps.method ?? ((): MiningMethod => "laser");

  const unsubscribe = deps.engine.onEvent((event) => {
    const sessionId = deps.engine.sessionId();
    switch (event.event) {
      case "ProspectedAsteroid":
        bus.publish("prospected", { prospect: toProspect(event), sessionId, method: method() });
        break;
      case "MiningRefined": {
        const resolved = commodityFromInternal(event.type);
        if (resolved.ok) bus.publish("refined", { commodityId: resolved.commodity.id, sessionId });
        break;
      }
      case "AsteroidCracked":
        bus.publish("cracked", { sessionId });
        break;
      case "MarketSell":
        priceBook.ingestSale(event);
        break;
      default:
        break;
    }
  });

  return {
    dispose: () => {
      unsubscribe();
      orchestrator.dispose();
    },
  };
}
