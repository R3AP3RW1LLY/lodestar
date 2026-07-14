/**
 * Hotspot scoring (SSOT Step 4.5, pure). The single ranking function over typed inputs:
 *
 *   score = price × overlap_multiplier × reserve_weight × ring_match
 *           − distance_penalty − sell_leg_penalty
 *
 * Every term is computed AND exposed in the returned `ScoreBreakdown` so the UI can
 * explain "why this score". Multiplicative terms build the `base` value; the two
 * distance penalties subtract from it. The breakdown reconciles EXACTLY:
 *   base  === price × overlapMultiplier × reserveWeight × ringMatch
 *   score === base − distancePenalty − sellLegPenalty
 * Confirmed overlaps boost via Step 4.4; candidates never do. Weights live in
 * `weights.ts` (versioned; Phase-6 calibration owns them).
 */

import type { RingOverlap } from "../hotspots/overlaps.js";
import { overlapMultiplier } from "../hotspots/overlaps.js";
import { DEFAULT_SCORING_WEIGHTS } from "./weights.js";
import type { ScoringWeights } from "./weights.js";

export interface ScoreInput {
  readonly commodityId: string;
  /** Best sell price (cr/ton). Negatives are clamped to 0. */
  readonly price: number;
  /** Normalized reserve level (Pristine … Depleted); undefined → neutral weight. */
  readonly reserve?: string;
  /** Normalized ring type (Metallic|MetalRich|Icy|Rocky); undefined → neutral match. */
  readonly ringType?: string;
  /** A confirmed overlap boosts; a candidate/none contributes ×1.0. */
  readonly overlap?: RingOverlap;
  /** Distance from the commander (ly). Undefined/negative → no penalty. */
  readonly distanceLy?: number;
  /** Distance to the sell station (ls). Undefined/negative → no penalty. */
  readonly sellLegLs?: number;
}

export interface ScoreBreakdown {
  readonly price: number;
  readonly overlapMultiplier: number;
  readonly reserveWeight: number;
  readonly ringMatch: number;
  /** price × overlapMultiplier × reserveWeight × ringMatch. */
  readonly base: number;
  readonly distancePenalty: number;
  readonly sellLegPenalty: number;
  /** base − distancePenalty − sellLegPenalty. */
  readonly score: number;
}

function reserveWeightFor(reserve: string | undefined, weights: ScoringWeights): number {
  if (reserve === undefined) return weights.reserveUnknown;
  return weights.reserveWeights[reserve] ?? weights.reserveUnknown;
}

function ringMatchFor(
  commodityId: string,
  ringType: string | undefined,
  weights: ScoringWeights,
): number {
  const affinity = weights.ringAffinity[commodityId];
  if (affinity === undefined || ringType === undefined) return weights.ringMatchUnknown;
  return affinity.includes(ringType) ? weights.ringMatchHit : weights.ringMatchMiss;
}

/** Score a (ring, commodity) mining candidate, exposing every term for UI explanation. */
export function scoreRing(
  input: ScoreInput,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): ScoreBreakdown {
  const price = Math.max(input.price, 0);
  const overlapMult = input.overlap === undefined ? 1.0 : overlapMultiplier(input.overlap);
  const reserveWeight = reserveWeightFor(input.reserve, weights);
  const ringMatch = ringMatchFor(input.commodityId, input.ringType, weights);
  const base = price * overlapMult * reserveWeight * ringMatch;
  const distancePenalty = Math.max(input.distanceLy ?? 0, 0) * weights.distancePenaltyPerLy;
  const sellLegPenalty = Math.max(input.sellLegLs ?? 0, 0) * weights.sellLegPenaltyPerLs;
  const score = base - distancePenalty - sellLegPenalty;
  return {
    price,
    overlapMultiplier: overlapMult,
    reserveWeight,
    ringMatch,
    base,
    distancePenalty,
    sellLegPenalty,
    score,
  };
}
