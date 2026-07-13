import { describe, expect, it } from "vitest";
import type { MiningMethod } from "@lodestar/shared";
import { mergeThresholds } from "./thresholds.js";
import { assay, contentTier } from "./verdict.js";
import type { ProspectInput, Reason } from "./verdict.js";

const th = mergeThresholds(); // default matrix (painite/platinum laser = 25, opal deep-core = 5)
const PRICES: Record<string, number> = {
  painite: 500_000,
  platinum: 200_000,
  opal: 1_500_000,
  gold: 47_000,
};
const price = (id: string): number | undefined => PRICES[id];

const HIGH = "$AsteroidMaterialContent_High;";

function prospect(over: Partial<ProspectInput>): ProspectInput {
  return { materials: [], content: HIGH, remainingPct: 100, ...over };
}

const has = (v: { reasons: readonly Reason[] }, code: Reason["code"]): boolean =>
  v.reasons.some((r) => r.code === code);

describe("assay verdict engine", () => {
  it("motherlode → MINE (deep-core payload), primary reason first", () => {
    const v = assay(
      prospect({ materials: [{ name: "Opal", proportion: 18 }], motherlode: "Opal" }),
      "deep-core",
      th,
      price,
    );
    expect(v.call).toBe("MINE");
    expect(v.reasons[0]).toEqual({
      code: "motherlode",
      commodityId: "opal",
      display: "Void Opals",
    });
    expect(has(v, "price-weighted-value/t")).toBe(true);
    expect(has(v, "content-tier")).toBe(true);
  });

  it("depleted motherlode → SKIP — depletion BEATS motherlode (precedence pinned)", () => {
    const v = assay(
      prospect({
        materials: [{ name: "Opal", proportion: 18 }],
        motherlode: "Opal",
        remainingPct: 0,
      }),
      "deep-core",
      th,
      price,
    );
    expect(v.call).toBe("SKIP");
    expect(v.reasons[0]).toEqual({ code: "already-depleted", remainingPct: 0 });
    expect(has(v, "motherlode")).toBe(false); // never claim motherlode on a dead rock
  });

  it("an unrecognized motherlode still MINEs, echoing the raw name (no crash)", () => {
    const v = assay(
      prospect({ materials: [{ name: "MysteryOre", proportion: 12 }], motherlode: "MysteryOre" }),
      "deep-core",
      th,
      price,
    );
    expect(v.call).toBe("MINE");
    expect(v.reasons[0]).toEqual({
      code: "motherlode",
      commodityId: "MysteryOre",
      display: "MysteryOre",
    });
  });

  it("a material at/above its threshold → MINE, with the proportion reason", () => {
    const v = assay(
      prospect({ materials: [{ name: "Painite", proportion: 30 }] }),
      "laser",
      th,
      price,
    );
    expect(v.call).toBe("MINE");
    expect(v.reasons[0]).toEqual({
      code: "proportion-above-threshold",
      commodityId: "painite",
      display: "Painite",
      proportion: 30,
      threshold: 25,
    });
  });

  it("boundary: proportion exactly at the threshold is MINE; just below is SKIP", () => {
    const atThreshold = assay(
      prospect({ materials: [{ name: "Painite", proportion: 25 }] }),
      "laser",
      th,
      price,
    );
    expect(atThreshold.call).toBe("MINE");
    const below = assay(
      prospect({ materials: [{ name: "Painite", proportion: 24.9 }] }),
      "laser",
      th,
      price,
    );
    expect(below.call).toBe("SKIP");
    expect(has(below, "proportion-above-threshold")).toBe(false);
  });

  it("multi-material rock leads with the dominant-VALUE qualifier, not the highest %", () => {
    // Painite 28% × 500k = 140k value BEATS Platinum 34% × 200k = 68k, despite the
    // lower proportion — the economically dominant commodity leads (UI/TTS speak it).
    const v = assay(
      prospect({
        materials: [
          { name: "Painite", proportion: 28 },
          { name: "Platinum", proportion: 34 },
        ],
      }),
      "laser",
      th,
      price,
    );
    expect(v.call).toBe("MINE");
    const first = v.reasons[0];
    expect(first?.code).toBe("proportion-above-threshold");
    if (first?.code === "proportion-above-threshold") expect(first.commodityId).toBe("painite");
  });

  it("with no price data, the dominant qualifier falls back to highest proportion", () => {
    const noPrice = (): number | undefined => undefined;
    const v = assay(
      prospect({
        materials: [
          { name: "Painite", proportion: 28 },
          { name: "Platinum", proportion: 34 },
        ],
      }),
      "laser",
      th,
      noPrice,
    );
    const first = v.reasons[0];
    if (first?.code === "proportion-above-threshold") expect(first.commodityId).toBe("platinum");
  });

  it("a material mined by the WRONG method does not qualify (deep-core opal, laser mining)", () => {
    // Void Opals are deep-core-only → no laser threshold → never a laser MINE.
    const v = assay(
      prospect({ materials: [{ name: "Opal", proportion: 90 }] }),
      "laser",
      th,
      price,
    );
    expect(v.call).toBe("SKIP");
  });

  it("a known-but-unthresholded commodity never qualifies (silver has no matrix entry)", () => {
    const v = assay(
      prospect({ materials: [{ name: "Silver", proportion: 95 }] }),
      "laser",
      th,
      price,
    );
    expect(v.call).toBe("SKIP");
  });

  it("negative remaining is treated as depleted → SKIP", () => {
    const v = assay(
      prospect({ materials: [{ name: "Painite", proportion: 50 }], remainingPct: -3 }),
      "laser",
      th,
      price,
    );
    expect(v.call).toBe("SKIP");
    expect(v.reasons[0]?.code).toBe("already-depleted");
  });

  it("an empty rock (no materials, not depleted, no motherlode) → SKIP, score 0", () => {
    const v = assay(prospect({ materials: [] }), "laser", th, price);
    expect(v.call).toBe("SKIP");
    expect(v.score).toBe(0);
  });

  it("SKIP when nothing meets its threshold and there is no motherlode", () => {
    const v = assay(
      prospect({ materials: [{ name: "Painite", proportion: 10 }] }),
      "laser",
      th,
      price,
    );
    expect(v.call).toBe("SKIP");
    expect(v.reasons.map((r) => r.code)).toEqual(["price-weighted-value/t", "content-tier"]);
  });

  it("computes a price-weighted value/t against canonical prices", () => {
    const v = assay(
      prospect({
        materials: [
          { name: "Painite", proportion: 30 }, // 500k × 0.30 = 150k
          { name: "Platinum", proportion: 10 }, // 200k × 0.10 = 20k
        ],
      }),
      "laser",
      th,
      price,
    );
    expect(v.score).toBeCloseTo(170_000, 5);
    const valueReason = v.reasons.find((r) => r.code === "price-weighted-value/t");
    expect(valueReason).toEqual({ code: "price-weighted-value/t", valuePerTon: 170_000 });
  });

  it("an unknown material contributes no value and never qualifies (SKIP)", () => {
    const v = assay(
      prospect({ materials: [{ name: "Adamantium", proportion: 80 }] }),
      "laser",
      th,
      price,
    );
    expect(v.call).toBe("SKIP");
    expect(v.score).toBe(0);
  });

  it("a valued commodity below its threshold with a low price is still SKIP", () => {
    // gold is laser-mineable but low value; below its 20% threshold → SKIP.
    const v = assay(
      prospect({ materials: [{ name: "Gold", proportion: 15 }] }),
      "laser",
      th,
      price,
    );
    expect(v.call).toBe("SKIP");
  });

  it("contentTier normalizes the raw content symbol", () => {
    expect(contentTier("$AsteroidMaterialContent_High;")).toBe("High");
    expect(contentTier("$AsteroidMaterialContent_Medium;")).toBe("Medium");
    expect(contentTier("$AsteroidMaterialContent_Low;")).toBe("Low");
    expect(contentTier("weird")).toBe("Unknown");
  });

  it("exercises every reason code across the suite", () => {
    const codes = new Set<Reason["code"]>();
    const record = (v: { reasons: readonly Reason[] }): void => {
      for (const r of v.reasons) codes.add(r.code);
    };
    const m: MiningMethod = "laser";
    record(
      assay(
        prospect({ materials: [{ name: "Opal", proportion: 5 }], motherlode: "Opal" }),
        "deep-core",
        th,
        price,
      ),
    );
    record(assay(prospect({ materials: [], remainingPct: 0 }), m, th, price));
    record(assay(prospect({ materials: [{ name: "Painite", proportion: 30 }] }), m, th, price));
    expect(codes).toEqual(
      new Set([
        "motherlode",
        "already-depleted",
        "proportion-above-threshold",
        "price-weighted-value/t",
        "content-tier",
      ]),
    );
  });
});
