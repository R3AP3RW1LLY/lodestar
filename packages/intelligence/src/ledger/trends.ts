/**
 * Price trend series (SSOT Step 4.11, pure). Folds market snapshots for a commodity into
 * time-bucketed points (avg + max sell price + sample count) for the Ledger trend chart.
 * No I/O; the caller passes the snapshots and the bucket size.
 */

import type { SellSnapshot } from "./best-sell.js";

export interface TrendPoint {
  /** Bucket start (ms epoch). */
  readonly tMs: number;
  readonly avgSellPrice: number;
  readonly maxSellPrice: number;
  readonly samples: number;
}

/** Bucket snapshots by `bucketMs` and summarize each bucket, ordered by time ascending. */
export function priceTrend(snapshots: readonly SellSnapshot[], bucketMs: number): TrendPoint[] {
  if (bucketMs <= 0) return [];
  const buckets = new Map<number, { sum: number; max: number; count: number }>();
  for (const snap of snapshots) {
    const key = Math.floor(snap.sourceTsMs / bucketMs) * bucketMs;
    const bucket = buckets.get(key) ?? { sum: 0, max: 0, count: 0 };
    bucket.sum += snap.sellPrice;
    bucket.max = Math.max(bucket.max, snap.sellPrice);
    bucket.count += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([tMs, b]) => ({
      tMs,
      avgSellPrice: b.sum / b.count,
      maxSellPrice: b.max,
      samples: b.count,
    }))
    .sort((a, b) => a.tMs - b.tMs);
}
