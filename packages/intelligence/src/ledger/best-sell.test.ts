import { describe, expect, it } from "vitest";
import { DEFAULT_SELL_WEIGHTS, freshnessWeight, rankSellStations } from "./best-sell.js";
import type { SellSnapshot } from "./best-sell.js";

const NOW = 1_000_000_000_000;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const snap = (over: Partial<SellSnapshot>): SellSnapshot => ({
  commodityId: "painite",
  marketId: 1,
  stationName: "Station",
  systemName: "System",
  sellPrice: 500_000,
  source: "journal",
  sourceTsMs: NOW,
  ...over,
});

describe("freshnessWeight", () => {
  it("is 1 while fresh, floors when stale, decays in between", () => {
    expect(freshnessWeight(0)).toBe(1);
    expect(freshnessWeight(HOUR)).toBe(1); // exactly at fullFreshMs
    expect(freshnessWeight(DAY)).toBe(DEFAULT_SELL_WEIGHTS.minFreshWeight);
    expect(freshnessWeight(2 * DAY)).toBe(DEFAULT_SELL_WEIGHTS.minFreshWeight);
    const mid = freshnessWeight(12 * HOUR);
    expect(mid).toBeGreaterThan(DEFAULT_SELL_WEIGHTS.minFreshWeight);
    expect(mid).toBeLessThan(1);
  });
});

describe("rankSellStations — golden ranking", () => {
  it("a fresh price beats a stale-but-higher one", () => {
    const ranked = rankSellStations(
      [
        snap({ marketId: 1, stationName: "Fresh", sellPrice: 500_000, sourceTsMs: NOW }),
        snap({
          marketId: 2,
          stationName: "StaleHigher",
          sellPrice: 550_000,
          sourceTsMs: NOW - DAY,
        }),
      ],
      NOW,
    );
    expect(ranked[0]?.stationName).toBe("Fresh"); // 500k×1 > 550k×0.5
  });

  it("a first-party (journal) price beats a conflicting EDDN price of the same value", () => {
    const ranked = rankSellStations(
      [
        snap({ marketId: 1, stationName: "EDDN", source: "eddn" }),
        snap({ marketId: 2, stationName: "Journal", source: "journal" }),
      ],
      NOW,
    );
    expect(ranked[0]?.stationName).toBe("Journal"); // 500k×1 > 500k×0.8
  });

  it("ranks a realistic fixture set best-first", () => {
    const ranked = rankSellStations(
      [
        snap({
          stationName: "A",
          sellPrice: 620_000,
          source: "journal",
          sourceTsMs: NOW - 30 * 60 * 1000,
        }),
        snap({ stationName: "B", sellPrice: 700_000, source: "eddn", sourceTsMs: NOW - 2 * DAY }),
        snap({ stationName: "C", sellPrice: 500_000, source: "capi", sourceTsMs: NOW }),
      ],
      NOW,
    );
    // A: 620k×1×1 = 620k ; B: 700k×0.8×0.5 = 280k ; C: 500k×1×1 = 500k
    expect(ranked.map((r) => r.stationName)).toEqual(["A", "C", "B"]);
  });
});

describe("rankSellStations — filters", () => {
  const set: SellSnapshot[] = [
    snap({ stationName: "Large", padSize: "L", distanceLs: 100, demand: 500 }),
    snap({ stationName: "Medium", padSize: "M", distanceLs: 100, demand: 500 }),
    snap({ stationName: "Far", padSize: "L", distanceLs: 5000, demand: 500 }),
    snap({ stationName: "LowDemand", padSize: "L", distanceLs: 100, demand: 10 }),
  ];

  it("filters out stations below the required pad size", () => {
    const ranked = rankSellStations(set, NOW, { minPad: "L" });
    expect(ranked.map((r) => r.stationName)).not.toContain("Medium");
  });

  it("filters out stations beyond max distance", () => {
    const ranked = rankSellStations(set, NOW, { maxDistanceLs: 1000 });
    expect(ranked.map((r) => r.stationName)).not.toContain("Far");
  });

  it("filters out stations below min demand", () => {
    const ranked = rankSellStations(set, NOW, { minDemand: 100 });
    expect(ranked.map((r) => r.stationName)).not.toContain("LowDemand");
  });

  it("uses the unknown-source trust for an unrecognized provenance", () => {
    const ranked = rankSellStations([snap({ source: "mystery" })], NOW);
    expect(ranked[0]?.score).toBe(500_000 * DEFAULT_SELL_WEIGHTS.unknownSourceTrust);
  });
});
