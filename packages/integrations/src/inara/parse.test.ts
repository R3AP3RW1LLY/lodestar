import { describe, expect, it } from "vitest";
import { isOk } from "@lodestar/shared";
import { parseInaraCommodityPrices, parseInaraEnvelope } from "./parse.js";
import { INARA_BAD_KEY, INARA_PRICES_OK } from "./fixtures.js";

describe("parseInaraEnvelope", () => {
  it("parses a 200 envelope with its events", () => {
    const result = parseInaraEnvelope(INARA_PRICES_OK);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value.headerStatus).toBe(200);
    expect(result.value.events).toHaveLength(1);
  });

  it("returns a typed error for a ≥400 header (invalid key)", () => {
    const result = parseInaraEnvelope(INARA_BAD_KEY);
    expect(isOk(result)).toBe(false);
    if (!isOk(result)) expect(result.error.code).toBe("inara/api-error");
  });

  it("rejects a malformed envelope (no header status)", () => {
    expect(isOk(parseInaraEnvelope({ events: [] }))).toBe(false);
  });
});

describe("parseInaraCommodityPrices", () => {
  it("maps recorded prices to canonical ids, dropping non-mining + malformed rows", () => {
    const envelope = parseInaraEnvelope(INARA_PRICES_OK);
    if (!isOk(envelope)) throw new Error("fixture parse failed");
    const prices = parseInaraCommodityPrices(envelope.value.events[0]?.data);
    expect(prices.map((p) => p.commodityId)).toEqual(["painite", "opal"]); // "Tea" dropped
    expect(prices[0]).toMatchObject({
      commodityId: "painite",
      sellPrice: 512340,
      demand: 1200,
      stationName: "Nemere Terminal",
      systemName: "Paesia",
      marketId: 128016640,
      updatedAt: "2025-06-01T12:00:00Z",
    });
  });

  it("returns [] for non-array eventData", () => {
    expect(parseInaraCommodityPrices({ not: "an array" })).toEqual([]);
    expect(parseInaraCommodityPrices(undefined)).toEqual([]);
  });

  it("drops rows missing required fields", () => {
    expect(parseInaraCommodityPrices([{ commodityName: "Painite", sellPrice: 5 }])).toEqual([]);
  });
});
