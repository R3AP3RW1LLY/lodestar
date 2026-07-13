import { describe, expect, it } from "vitest";
import { COMMODITIES, commodityById } from "@lodestar/shared";
import type { CommodityId, MiningMethod } from "@lodestar/shared";
import {
  DEFAULT_THRESHOLDS,
  MOTHERLODE_ALWAYS_MINE,
  defaultThreshold,
  mergeThresholds,
} from "./thresholds.js";

describe("worth-mining threshold matrix", () => {
  it("motherlode is always-mine (precedence resolved in the verdict engine)", () => {
    expect(MOTHERLODE_ALWAYS_MINE).toBe(true);
  });

  it("every entry keys on a real commodity (exists in the 2.2 dictionary)", () => {
    for (const e of DEFAULT_THRESHOLDS) {
      expect(commodityById(e.commodityId), `unknown commodity ${e.commodityId}`).toBeDefined();
    }
  });

  it("every entry's method is one that commodity is actually mineable by (2.2 methods)", () => {
    for (const e of DEFAULT_THRESHOLDS) {
      const methods = commodityById(e.commodityId)?.methods ?? [];
      expect(methods, `${e.commodityId} not ${e.method}-mineable`).toContain(e.method);
    }
  });

  it("every entry carries a non-empty provenance note and a 0–100 proportion", () => {
    for (const e of DEFAULT_THRESHOLDS) {
      expect(e.note.length).toBeGreaterThan(0);
      expect(e.minProportion).toBeGreaterThanOrEqual(0);
      expect(e.minProportion).toBeLessThanOrEqual(100);
    }
  });

  it("has no duplicate commodity×method entries", () => {
    const keys = DEFAULT_THRESHOLDS.map((e) => `${e.commodityId} ${e.method}`);
    expect(new Set(keys).size).toBe(DEFAULT_THRESHOLDS.length);
  });

  it("matches the SSOT §2.3 matrix EXACTLY (id sets transcribed from the spec, no drift)", () => {
    const byMethod = (m: MiningMethod): Set<string> =>
      new Set(DEFAULT_THRESHOLDS.filter((e) => e.method === m).map((e) => e.commodityId));
    expect(byMethod("laser")).toEqual(
      new Set([
        "platinum",
        "painite",
        "osmium",
        "palladium",
        "gold",
        "lowtemperaturediamond",
        "bromellite",
        "tritium",
      ]),
    );
    expect(byMethod("deep-core")).toEqual(
      new Set([
        "opal",
        "lowtemperaturediamond",
        "alexandrite",
        "benitoite",
        "musgravite",
        "serendibite",
        "grandidierite",
        "monazite",
        "rhodplumsite",
        "painite",
        "bromellite",
      ]),
    );
    expect(byMethod("subsurface")).toEqual(
      new Set(["lowtemperaturediamond", "platinum", "painite", "bromellite", "tritium"]),
    );
  });

  it("covers the SSOT-listed sets (spot-checks)", () => {
    // Painite is worth-mining by all three methods; Void Opals only deep-core.
    expect(defaultThreshold("painite", "laser")).toBeDefined();
    expect(defaultThreshold("painite", "deep-core")).toBeDefined();
    expect(defaultThreshold("painite", "subsurface")).toBeDefined();
    expect(defaultThreshold("platinum", "subsurface")).toBeDefined();
    expect(defaultThreshold("opal", "deep-core")).toBeDefined();
  });

  it("defaultThreshold returns the value for a known pair, undefined otherwise", () => {
    expect(defaultThreshold("platinum", "laser")).toBe(25);
    expect(defaultThreshold("gold", "deep-core")).toBeUndefined(); // gold isn't deep-core mineable
    expect(defaultThreshold("unobtanium", "laser")).toBeUndefined();
  });

  it("mergeThresholds lets a user override win over the default", () => {
    const resolve = mergeThresholds([
      { commodityId: "platinum", method: "laser", minProportion: 40 },
    ]);
    expect(resolve("platinum", "laser")).toBe(40); // overridden
    expect(resolve("painite", "laser")).toBe(25); // untouched default
    expect(resolve("gold", "deep-core")).toBeUndefined(); // still not worth mining
  });

  it("mergeThresholds with no overrides equals the defaults", () => {
    const resolve = mergeThresholds();
    for (const e of DEFAULT_THRESHOLDS) {
      expect(resolve(e.commodityId, e.method)).toBe(e.minProportion);
    }
  });

  it("compile-time: an entry commodityId is a CommodityId (type-level guard)", () => {
    // If this list drifts from the union, the file would not compile. Runtime echo:
    const ids = new Set<CommodityId>(COMMODITIES.map((c) => c.id));
    for (const e of DEFAULT_THRESHOLDS) {
      const method: MiningMethod = e.method;
      expect(ids.has(e.commodityId)).toBe(true);
      expect(["laser", "deep-core", "subsurface"]).toContain(method);
    }
  });
});
