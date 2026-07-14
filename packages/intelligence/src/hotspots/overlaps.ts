/**
 * Overlap model + candidate detection (SSOT Step 4.4, pure). Journals expose hotspot
 * *counts*, not positions, so whether two commodities' hotspots physically overlap is
 * epistemically INVISIBLE from scan data alone. LODESTAR is honest about this:
 *   - **candidate** — a ring with ≥2 distinct commodities: an overlap is *possible*.
 *     Listed unranked; signal counts carry zero positional information, so we make NO
 *     likelihood claim and grant NO score boost.
 *   - **confirmed** — the commander saw it in-game (or a trusted community source):
 *     only these stack yields, via a multiplicity multiplier.
 * Pure functions over pure data — the DB persistence lives in `@lodestar/data`, the
 * score consumption in Step 4.5.
 */

export type OverlapConfidence = "candidate" | "confirmed";

export interface HotspotObservation {
  readonly commodityId: string;
  readonly count: number;
}

/** The pure overlap model (distinct from the data-layer row, which adds ids). */
export interface RingOverlap {
  /** Distinct canonical commodity ids sharing the ring, sorted for determinism. */
  readonly commodities: readonly string[];
  /** Number of co-located commodities (= `commodities.length`). */
  readonly multiplicity: number;
  readonly confidence: OverlapConfidence;
  readonly source: string;
}

export interface OverlapWeights {
  readonly version: number;
  /** Yield multiplier indexed by multiplicity; clamped to the last entry beyond its end. */
  readonly byMultiplicity: readonly number[];
  readonly note: string;
}

/**
 * PROVISIONAL community-documented overlap-yield multipliers: a *confirmed* overlap
 * stacks hotspot yields, growing with how many commodities co-locate. Exact factors are
 * Phase-6 Bayesian-calibration targets (verified against current game mechanics before
 * shipping as calibrated); candidates never boost (that rule lives in `overlapMultiplier`,
 * not this table). Index = multiplicity; [0]/[1] are 1.0 because a lone hotspot is not an
 * overlap.
 */
export const DEFAULT_OVERLAP_WEIGHTS: OverlapWeights = {
  version: 1,
  byMultiplicity: [1.0, 1.0, 1.35, 1.7, 2.0],
  note: "provisional; confirmed-overlap yield stacking, Phase-6 calibration target",
};

/**
 * From a ring's hotspots, a candidate overlap exists iff ≥2 DISTINCT commodities share
 * the ring. Returns `undefined` otherwise (nothing to flag). Never ranks by count.
 */
export function detectOverlapCandidate(
  hotspots: readonly HotspotObservation[],
  source = "journal",
): RingOverlap | undefined {
  const distinct = [...new Set(hotspots.map((h) => h.commodityId))].sort();
  if (distinct.length < 2) return undefined;
  return {
    commodities: distinct,
    multiplicity: distinct.length,
    confidence: "candidate",
    source,
  };
}

/** Promote an overlap to `confirmed` (the commander verified it). Idempotent. */
export function confirmOverlap(overlap: RingOverlap, source?: string): RingOverlap {
  return {
    ...overlap,
    confidence: "confirmed",
    source: source ?? overlap.source,
  };
}

/**
 * The scoring multiplier for an overlap. **Candidates always return exactly 1.0** — no
 * likelihood, no boost. Only a confirmed overlap stacks yields, by multiplicity (clamped
 * to the weights table). A single-commodity "overlap" is 1.0 (not an overlap).
 */
export function overlapMultiplier(
  overlap: RingOverlap,
  weights: OverlapWeights = DEFAULT_OVERLAP_WEIGHTS,
): number {
  if (overlap.confidence === "candidate") return 1.0;
  const table = weights.byMultiplicity;
  const index = Math.min(Math.max(overlap.multiplicity, 0), table.length - 1);
  return table[index] ?? 1.0;
}
