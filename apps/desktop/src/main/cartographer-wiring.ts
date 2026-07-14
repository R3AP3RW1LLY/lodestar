/**
 * Cartographer main-process bridge (SSOT Step 4.12c). Assembles round-trip PLAN REQUESTS
 * from the galaxy DB — each hotspot ↔ its best Ledger sell station (whose system must be
 * known so we can route to it) — plans + ranks them via the core plan service (straight-
 * line legs for now; a Spansh-backed provider can be injected later), and holds the last
 * ranked list so a save persists by index. A plan is DATA the player copies by hand.
 */

import type { Db } from "@lodestar/data";
import { createSystemRepository } from "@lodestar/data";
import { createLedgerService, createPlanService, straightLineRouteProvider } from "@lodestar/core";
import type { PlanRequest, RunPlan } from "@lodestar/core";
import type { PlanStrategy, RunPlanView } from "@lodestar/shared";

export interface CartographerOptions {
  readonly cargoCapacity: number;
  readonly jumpRangeLy: number;
  readonly secondsPerJump: number;
  readonly miningTph: number;
  readonly maxCandidates: number;
  readonly now: () => number;
}

export const DEFAULT_CARTOGRAPHER_OPTIONS: Omit<CartographerOptions, "now"> = {
  cargoCapacity: 256,
  jumpRangeLy: 30,
  secondsPerJump: 45,
  miningTph: 150, // provisional flat estimate; per-method calibration later
  maxCandidates: 25,
};

export interface CartographerBridge {
  plan: (strategy: PlanStrategy) => Promise<readonly RunPlanView[]>;
  save: (index: number, at: string) => number | null;
}

interface HotspotRow {
  readonly commodity_id: string;
  readonly ring_name: string;
  readonly system_name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const toView = (plan: RunPlan): RunPlanView => ({
  candidate: {
    ringName: plan.candidate.ringName,
    commodityId: plan.candidate.commodityId,
    systemName: plan.candidate.systemName,
    miningTph: plan.candidate.miningTph,
    sellStation: plan.candidate.sellStation,
    sellSystem: plan.candidate.sellSystem,
    sellPrice: plan.candidate.sellPrice,
    outboundLegs: plan.candidate.outboundLegs,
    returnLegs: plan.candidate.returnLegs,
    minSecurity: plan.candidate.minSecurity,
  },
  fillTimeSec: plan.fillTimeSec,
  travelTimeSec: plan.travelTimeSec,
  totalTimeSec: plan.totalTimeSec,
  totalJumps: plan.totalJumps,
  cargoValue: plan.cargoValue,
  estimatedTph: plan.estimatedTph,
  estimatedCph: plan.estimatedCph,
});

export function createCartographerBridge(db: Db, options: CartographerOptions): CartographerBridge {
  const ledger = createLedgerService(db, options.now);
  const systems = createSystemRepository(db);
  const planService = createPlanService(db, straightLineRouteProvider(options.jumpRangeLy));
  const hotspotStmt = db.prepare(
    `SELECT h.commodity_id, r.name AS ring_name, sys.name AS system_name, sys.x, sys.y, sys.z
       FROM hotspots h
       JOIN rings r ON r.id = h.ring_id
       JOIN bodies b ON b.id = r.body_id
       JOIN systems sys ON sys.id = b.system_id
      ORDER BY h.count DESC
      LIMIT ?`,
  );

  let lastPlans: RunPlan[] = [];

  function buildRequests(): PlanRequest[] {
    const requests: PlanRequest[] = [];
    for (const row of hotspotStmt.all(options.maxCandidates) as HotspotRow[]) {
      const best = ledger.bestStations(row.commodity_id)[0];
      if (best === undefined) continue; // no known price → can't estimate profit
      const sellSystem = systems.byName(best.systemName);
      if (sellSystem === undefined) continue; // unknown sell system → can't route
      requests.push({
        ringName: row.ring_name,
        commodityId: row.commodity_id,
        miningSystem: { name: row.system_name, x: row.x, y: row.y, z: row.z },
        hotspotScore: 0,
        miningTph: options.miningTph,
        sellStation: best.stationName,
        sellSystem: { name: sellSystem.name, x: sellSystem.x, y: sellSystem.y, z: sellSystem.z },
        sellPrice: best.sellPrice,
      });
    }
    return requests;
  }

  return {
    async plan(strategy) {
      const result = await planService.planRuns(
        buildRequests(),
        { cargoCapacity: options.cargoCapacity, secondsPerJump: options.secondsPerJump },
        strategy,
      );
      lastPlans = result.ok ? result.value : [];
      return lastPlans.map(toView);
    },
    save: (index, at) => {
      const plan = lastPlans[index];
      return plan === undefined ? null : planService.savePlan(plan, at);
    },
  };
}

/** Empty bridge for when there is no database. */
export function emptyCartographerBridge(): CartographerBridge {
  return {
    plan: () => Promise.resolve([]),
    save: () => null,
  };
}
