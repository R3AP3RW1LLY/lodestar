import { describe, expect, it } from "vitest";
import { isOk } from "@lodestar/shared";
import {
  DEFAULT_PLAUSIBILITY,
  isPlausiblePrice,
  parseEddnCommodityMessage,
} from "./commodity-schema.js";
import { EDDN_PAESIA_MARKET, EDDN_WRONG_SCHEMA } from "./fixtures.js";

describe("isPlausiblePrice", () => {
  it("accepts a normal price + demand", () => {
    expect(isPlausiblePrice("painite", 512340, 1200)).toBe(true);
  });

  it.each([
    ["negative", -1, 100],
    ["zero", 0, 100],
    ["NaN", Number.NaN, 100],
    ["Infinity", Number.POSITIVE_INFINITY, 100],
    ["10× the band", 9_000_000, 100],
  ])("rejects an implausible painite price (%s)", (_label, price, demand) => {
    expect(isPlausiblePrice("painite", price, demand)).toBe(false);
  });

  it.each([
    ["negative demand", 500000, -5],
    ["NaN demand", 500000, Number.NaN],
    ["absurd demand", 500000, DEFAULT_PLAUSIBILITY.maxDemand + 1],
  ])("rejects insane demand (%s)", (_label, price, demand) => {
    expect(isPlausiblePrice("painite", price, demand)).toBe(false);
  });

  it("uses the generic ceiling for a commodity without a specific band", () => {
    expect(isPlausiblePrice("bertrandite", 1_900_000, 10)).toBe(true); // under generic 2M
    expect(isPlausiblePrice("bertrandite", 2_100_000, 10)).toBe(false); // over generic 2M
  });
});

describe("parseEddnCommodityMessage", () => {
  it("keeps canonical mining commodities that pass plausibility, counting the drops", () => {
    const result = parseEddnCommodityMessage(EDDN_PAESIA_MARKET);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.market).toMatchObject({
      systemName: "Paesia",
      marketId: 128016640,
      timestamp: "2025-06-01T12:00:00Z",
    });
    expect(result.value.market.commodities.map((c) => c.commodityId)).toEqual([
      "painite",
      "platinum",
    ]);
    // "tea" (non-mining) + the 9M painite (implausible) were dropped.
    expect(result.value.dropped).toBe(2);
  });

  it("rejects a wrong-schema envelope", () => {
    const result = parseEddnCommodityMessage(EDDN_WRONG_SCHEMA);
    expect(isOk(result)).toBe(false);
    if (!isOk(result)) expect(result.error.code).toBe("eddn/wrong-schema");
  });

  it("rejects a malformed message body", () => {
    const result = parseEddnCommodityMessage({
      $schemaRef: "https://eddn.edcd.io/schemas/commodity/3",
      message: { systemName: "X" }, // missing required fields
    });
    expect(isOk(result)).toBe(false);
    if (!isOk(result)) expect(result.error.code).toBe("eddn/bad-message");
  });

  it("drops malformed commodity rows without failing the whole message", () => {
    const result = parseEddnCommodityMessage({
      $schemaRef: "https://eddn.edcd.io/schemas/commodity/3",
      message: {
        systemName: "X",
        stationName: "S",
        marketId: 1,
        timestamp: "t",
        commodities: [
          { name: "painite", sellPrice: 500000, demand: 100 },
          { name: "painite" }, // missing prices → dropped
          42, // not an object → dropped
        ],
      },
    });
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.market.commodities).toHaveLength(1);
    expect(result.value.dropped).toBe(2);
  });
});
