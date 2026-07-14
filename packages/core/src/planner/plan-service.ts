/**
 * Plan service (SSOT Step 4.12b). Orchestrates the round-trip planner: turns mining +
 * sell candidates into full `RunCandidate`s (fetching route legs from an INJECTED
 * `RouteProvider`), ranks them via the pure `intelligence` planner, and persists a chosen
 * plan to the `runs` table with its estimates. `core` may not import `integrations`, so
 * the Spansh-backed provider is injected by the desktop; a pure `straightLineRouteProvider`
 * is the real, no-network fallback. Nothing here controls the game — a plan is data.
 */

import type { Db } from "@lodestar/data";
import { createRunRepository } from "@lodestar/data";
import type { DomainError, Result } from "@lodestar/shared";
import { err, ok } from "@lodestar/shared";
import type { PlanInput, PlanStrategy, RunCandidate, RunPlan } from "@lodestar/intelligence";
import { rankPlans } from "@lodestar/intelligence";

export interface Coords {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RouteLeg {
  readonly from: string;
  readonly to: string;
  readonly distanceLy: number;
  readonly jumps: number;
}

export interface RouteInfo {
  readonly legs: readonly RouteLeg[];
  /** Lowest system security along the route (0..1); providers without it use 0.5. */
  readonly minSecurity: number;
}

export interface NamedSystem extends Coords {
  readonly name: string;
}

export interface RouteProvider {
  route: (from: NamedSystem, to: NamedSystem) => Promise<Result<RouteInfo, DomainError>>;
}

/** A pure, no-network provider: straight-line distance, jumps = ceil(distance / jumpRange). */
export function straightLineRouteProvider(jumpRangeLy: number, minSecurity = 0.5): RouteProvider {
  const range = Math.max(jumpRangeLy, 1e-9);
  return {
    route: (from, to) => {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const dz = to.z - from.z;
      const distanceLy = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const jumps = distanceLy === 0 ? 0 : Math.max(1, Math.ceil(distanceLy / range));
      return Promise.resolve(
        ok({ legs: [{ from: from.name, to: to.name, distanceLy, jumps }], minSecurity }),
      );
    },
  };
}

export interface PlanRequest {
  readonly ringName: string;
  readonly commodityId: string;
  readonly miningSystem: NamedSystem;
  readonly hotspotScore: number;
  readonly miningTph: number;
  readonly sellStation: string;
  readonly sellSystem: NamedSystem;
  readonly sellPrice: number;
}

export interface PlanService {
  planRuns: (
    requests: readonly PlanRequest[],
    input: PlanInput,
    strategy: PlanStrategy,
  ) => Promise<Result<RunPlan[], DomainError>>;
  /** Persist a plan to `runs` with its estimates; returns the run id. */
  savePlan: (plan: RunPlan, at: string) => number;
}

const reverseLeg = (leg: RouteLeg): RouteLeg => ({
  from: leg.to,
  to: leg.from,
  distanceLy: leg.distanceLy,
  jumps: leg.jumps,
});

export function createPlanService(db: Db, routeProvider: RouteProvider): PlanService {
  const runs = createRunRepository(db);

  return {
    async planRuns(requests, input, strategy) {
      const candidates: RunCandidate[] = [];
      for (const request of requests) {
        const route = await routeProvider.route(request.miningSystem, request.sellSystem);
        if (!route.ok) return err(route.error);
        candidates.push({
          ringName: request.ringName,
          commodityId: request.commodityId,
          systemName: request.miningSystem.name,
          hotspotScore: request.hotspotScore,
          miningTph: request.miningTph,
          sellStation: request.sellStation,
          sellSystem: request.sellSystem.name,
          sellPrice: request.sellPrice,
          outboundLegs: route.value.legs,
          returnLegs: route.value.legs.map(reverseLeg),
          minSecurity: route.value.minSecurity,
        });
      }
      return ok(rankPlans(candidates, input, strategy));
    },
    savePlan: (plan, at) =>
      runs.create(
        {
          plan: JSON.stringify(plan),
          estimatedTph: plan.estimatedTph,
          estimatedCph: plan.estimatedCph,
        },
        at,
      ),
  };
}
