/**
 * Round-trip run planner (SSOT Step 4.12, pure). Combines a scored hotspot (Step 4.5) +
 * a Ledger sell pick (4.11) + passed-in route legs into a full **mine here → sell there →
 * return** plan with time/profit estimates, then ranks candidates by strategy (4.12
 * `strategies.ts`). No I/O and — critically — **no game control**: a plan is data the
 * player copies into the galaxy map by hand. Legs are supplied by the caller (Spansh or a
 * straight-line fallback); this module only does the estimate arithmetic + ranking.
 */

import type { PlanStrategy } from "./strategies.js";
import { planComparator } from "./strategies.js";

export interface RunLeg {
  readonly from: string;
  readonly to: string;
  readonly distanceLy: number;
  readonly jumps: number;
}

export interface RunCandidate {
  readonly ringName: string;
  readonly commodityId: string;
  readonly systemName: string;
  readonly hotspotScore: number;
  /** Estimated mining throughput at the ring (tons/hr, > 0). */
  readonly miningTph: number;
  readonly sellStation: string;
  readonly sellSystem: string;
  readonly sellPrice: number;
  readonly outboundLegs: readonly RunLeg[];
  readonly returnLegs: readonly RunLeg[];
  /** Lowest system security along the route (0 anarchy … 1 high-sec), for "safest". */
  readonly minSecurity: number;
}

export interface PlanInput {
  readonly cargoCapacity: number;
  readonly secondsPerJump: number;
}

export interface RunPlan {
  readonly candidate: RunCandidate;
  readonly fillTimeSec: number;
  readonly travelTimeSec: number;
  readonly totalTimeSec: number;
  readonly totalJumps: number;
  readonly cargoValue: number;
  /** Effective tons/hr over the WHOLE round trip (fill + travel). */
  readonly estimatedTph: number;
  /** Effective cr/hr over the whole round trip. */
  readonly estimatedCph: number;
}

const sumJumps = (legs: readonly RunLeg[]): number => legs.reduce((n, leg) => n + leg.jumps, 0);

/** Compute the full time/profit estimate for one candidate round trip. */
export function planRun(candidate: RunCandidate, input: PlanInput): RunPlan {
  const cargo = Math.max(0, input.cargoCapacity);
  const tph = Math.max(candidate.miningTph, 1e-9); // guard divide-by-zero
  const fillTimeSec = (cargo / tph) * 3600;
  const totalJumps = sumJumps(candidate.outboundLegs) + sumJumps(candidate.returnLegs);
  const travelTimeSec = totalJumps * Math.max(0, input.secondsPerJump);
  const totalTimeSec = fillTimeSec + travelTimeSec;
  const cargoValue = cargo * Math.max(0, candidate.sellPrice);
  const hours = totalTimeSec / 3600 || 1e-9;
  return {
    candidate,
    fillTimeSec,
    travelTimeSec,
    totalTimeSec,
    totalJumps,
    cargoValue,
    estimatedTph: cargo / hours,
    estimatedCph: cargoValue / hours,
  };
}

/** Plan every candidate and order them by the chosen strategy (best first). */
export function rankPlans(
  candidates: readonly RunCandidate[],
  input: PlanInput,
  strategy: PlanStrategy,
): RunPlan[] {
  return candidates.map((c) => planRun(c, input)).sort(planComparator(strategy));
}
