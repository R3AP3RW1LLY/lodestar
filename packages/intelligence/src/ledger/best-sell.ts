/**
 * Best-sell-station ranking (SSOT Step 4.11, pure). Ranks candidate sell stations for a
 * commodity from passed-in market snapshots — no I/O. Demand-aware, pad-size + distance
 * filtered, and **freshness-weighted with source trust**, so:
 *   - a first-party price (own journal `Market.json`, cAPI) outranks a conflicting EDDN
 *     price of the same value (EDDN is a spoofable firehose — advisory only), and
 *   - a fresh price beats a stale-but-nominally-higher one when the weights say so.
 * Weight vectors are versioned defaults (Phase-6 calibration owns them).
 */

export interface SellSnapshot {
  readonly commodityId: string;
  readonly marketId: number;
  readonly stationName: string;
  readonly systemName: string;
  readonly sellPrice: number;
  /** Provenance: `journal`/`capi` are first-party; `inara`/`eddn`/`seed` are external. */
  readonly source: string;
  /** Observation time (ms epoch). */
  readonly sourceTsMs: number;
  readonly padSize?: string;
  readonly demand?: number;
  readonly distanceLs?: number;
}

export type PadSize = "S" | "M" | "L";

export interface SellFilter {
  readonly minPad?: PadSize;
  readonly maxDistanceLs?: number;
  readonly minDemand?: number;
}

export interface SellWeights {
  readonly version: number;
  /** Trust multiplier by source (first-party > community). */
  readonly sourceTrust: Readonly<Record<string, number>>;
  readonly unknownSourceTrust: number;
  /** A price at/under this age (ms) is fully fresh (weight 1). */
  readonly fullFreshMs: number;
  /** A price at/over this age (ms) is floored to `minFreshWeight`. */
  readonly staleMs: number;
  readonly minFreshWeight: number;
  readonly note: string;
}

export const DEFAULT_SELL_WEIGHTS: SellWeights = {
  version: 2,
  // First-party = the commander's own data. The production journal writer (price-book.ts)
  // stamps `market` (Market.json on dock) and `marketsell` (MarketSell); `journal`/`capi`
  // are kept for forward sinks. All rank 1.0 — strictly above the spoofable EDDN firehose.
  sourceTrust: {
    market: 1.0,
    marketsell: 1.0,
    journal: 1.0,
    capi: 1.0,
    inara: 0.9,
    eddn: 0.8,
    seed: 0.7,
  },
  unknownSourceTrust: 0.75,
  fullFreshMs: 60 * 60 * 1000, // 1 h
  staleMs: 24 * 60 * 60 * 1000, // 24 h
  minFreshWeight: 0.5,
  note: "provisional; first-party > community source trust + freshness decay (Phase-6 calibration)",
};

export interface RankedStation extends SellSnapshot {
  readonly ageMs: number;
  readonly score: number;
}

const PAD_RANK: Readonly<Record<string, number>> = { S: 1, M: 2, L: 3 };

function padSatisfies(stationPad: string | undefined, minPad: PadSize): boolean {
  const have = stationPad === undefined ? 0 : (PAD_RANK[stationPad] ?? 0);
  return have >= (PAD_RANK[minPad] ?? 0);
}

/** Linear freshness decay from 1.0 (≤ fullFreshMs) to minFreshWeight (≥ staleMs). */
export function freshnessWeight(
  ageMs: number,
  weights: SellWeights = DEFAULT_SELL_WEIGHTS,
): number {
  if (ageMs <= weights.fullFreshMs) return 1;
  if (ageMs >= weights.staleMs) return weights.minFreshWeight;
  const span = weights.staleMs - weights.fullFreshMs;
  const decayed = 1 - ((ageMs - weights.fullFreshMs) / span) * (1 - weights.minFreshWeight);
  return decayed;
}

/**
 * Rank sell stations best-first. Filters by pad/distance/demand, then scores by
 * `sellPrice × sourceTrust × freshnessWeight`. Ties break on raw sell price then recency.
 */
export function rankSellStations(
  snapshots: readonly SellSnapshot[],
  nowMs: number,
  filter: SellFilter = {},
  weights: SellWeights = DEFAULT_SELL_WEIGHTS,
): RankedStation[] {
  const ranked: RankedStation[] = [];
  for (const snap of snapshots) {
    if (filter.minPad !== undefined && !padSatisfies(snap.padSize, filter.minPad)) continue;
    if (
      filter.maxDistanceLs !== undefined &&
      snap.distanceLs !== undefined &&
      snap.distanceLs > filter.maxDistanceLs
    ) {
      continue;
    }
    if (filter.minDemand !== undefined && (snap.demand ?? 0) < filter.minDemand) continue;
    const ageMs = Math.max(0, nowMs - snap.sourceTsMs);
    const trust = weights.sourceTrust[snap.source] ?? weights.unknownSourceTrust;
    const score = snap.sellPrice * trust * freshnessWeight(ageMs, weights);
    ranked.push({ ...snap, ageMs, score });
  }
  return ranked.sort(
    (a, b) => b.score - a.score || b.sellPrice - a.sellPrice || b.sourceTsMs - a.sourceTsMs,
  );
}
