import { describe, expect, it } from "vitest";
import { computeProspectStats, emptyProspectStats } from "./prospect-stats.js";
import type { ProspectStatEntry } from "./prospect-stats.js";

const e = (
  verdict: "MINE" | "SKIP" | undefined,
  materials: { name: string; proportion: number }[],
  motherlode?: string,
): ProspectStatEntry =>
  motherlode === undefined ? { verdict, materials } : { verdict, materials, motherlode };

describe("computeProspectStats", () => {
  it("empty session → zeroed stats", () => {
    expect(computeProspectStats([])).toEqual(emptyProspectStats());
  });

  it("golden fixture session yields exact hand-computed stats", () => {
    // 5 prospects: 3 MINE, 2 motherlode; dominant materials painite×3, platinum, rutile.
    const session: ProspectStatEntry[] = [
      e(
        "MINE",
        [
          { name: "painite", proportion: 30 },
          { name: "platinum", proportion: 8 },
        ],
        "painite",
      ),
      e("MINE", [{ name: "platinum", proportion: 34 }]),
      e("SKIP", [{ name: "rutile", proportion: 3 }]), // rutile: unknown commodity → lowercased fallback
      e("SKIP", [{ name: "painite", proportion: 12 }]),
      e("MINE", [{ name: "painite", proportion: 28 }], "painite"),
    ];
    const stats = computeProspectStats(session);
    expect(stats.prospected).toBe(5);
    expect(stats.mineVerdicts).toBe(3);
    expect(stats.hitRate).toBeCloseTo(0.6, 10); // 3 / 5
    expect(stats.avgBestMaterialPct).toBeCloseTo(21.4, 10); // (30+34+3+12+28)/5
    expect(stats.motherlodeCount).toBe(2);
    expect(stats.byCommodity).toEqual({ painite: 3, platinum: 1, rutile: 1 });
  });

  it("counts the DOMINANT (highest-proportion) material per prospect, canonicalized", () => {
    const stats = computeProspectStats([
      // A $..._name; symbol + a bare name both canonicalize to the same id.
      e("MINE", [
        { name: "$painite_name;", proportion: 40 },
        { name: "gold", proportion: 5 },
      ]),
      e("SKIP", [
        { name: "gold", proportion: 60 },
        { name: "painite", proportion: 10 },
      ]),
    ]);
    expect(stats.byCommodity).toEqual({ painite: 1, gold: 1 });
  });

  it("a material-less rock counts toward prospected but does not dilute avgBestMaterialPct", () => {
    const stats = computeProspectStats([
      e("SKIP", [{ name: "painite", proportion: 20 }]),
      e("SKIP", []), // empty rock — no dominant material
    ]);
    expect(stats.prospected).toBe(2);
    expect(stats.avgBestMaterialPct).toBe(20); // 20 / 1 (one rock with materials), not 20/2
    expect(stats.byCommodity).toEqual({ painite: 1 });
  });

  it("an un-assayed prospect (verdict undefined) counts toward prospected but not the hit rate", () => {
    const stats = computeProspectStats([
      e(undefined, [{ name: "painite", proportion: 20 }]),
      e("MINE", [{ name: "painite", proportion: 25 }]),
    ]);
    expect(stats.prospected).toBe(2);
    expect(stats.mineVerdicts).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5, 10);
  });
});
