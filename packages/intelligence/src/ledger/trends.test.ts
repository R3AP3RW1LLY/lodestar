import { describe, expect, it } from "vitest";
import { priceTrend } from "./trends.js";
import type { SellSnapshot } from "./best-sell.js";

const HOUR = 60 * 60 * 1000;

const snap = (sourceTsMs: number, sellPrice: number): SellSnapshot => ({
  commodityId: "painite",
  marketId: 1,
  stationName: "S",
  systemName: "Y",
  sellPrice,
  source: "eddn",
  sourceTsMs,
});

describe("priceTrend", () => {
  it("buckets by time and reports avg + max + samples, time-ascending", () => {
    const points = priceTrend(
      [
        snap(0, 400_000),
        snap(HOUR - 1, 600_000), // same first bucket as t=0 (bucket size 1h)
        snap(2 * HOUR, 500_000), // a later bucket
      ],
      HOUR,
    );
    expect(points).toEqual([
      { tMs: 0, avgSellPrice: 500_000, maxSellPrice: 600_000, samples: 2 },
      { tMs: 2 * HOUR, avgSellPrice: 500_000, maxSellPrice: 500_000, samples: 1 },
    ]);
  });

  it("returns [] for no snapshots or a non-positive bucket size", () => {
    expect(priceTrend([], HOUR)).toEqual([]);
    expect(priceTrend([snap(0, 1)], 0)).toEqual([]);
  });
});
