import { describe, expect, it } from "vitest";
import type { SaaSignalsFoundEvent } from "@lodestar/shared";
import { commodityFromSaaSignal, interpretSaaSignals, ringBodyName } from "./saa-signals.js";

const saa = (
  bodyName: string,
  signals: { type: string; count: number }[],
): SaaSignalsFoundEvent => ({
  event: "SAASignalsFound",
  timestamp: "2025-06-01T00:00:00Z",
  bodyName,
  systemAddress: 1,
  bodyId: 5,
  signals,
});

describe("ringBodyName", () => {
  it.each([
    ["Paesia 2 A Ring", "Paesia 2"],
    ["Borann A 2 A Ring", "Borann A 2"],
    ["Hyades Sector DB-X d1-112 A 1 A Ring", "Hyades Sector DB-X d1-112 A 1"],
  ])("parses the parent body of %s", (ring, body) => {
    expect(ringBodyName(ring)).toBe(body);
  });

  it.each(["Nervi 2 a", "Paesia 2 A Belt", "Sol"])("returns undefined for non-ring %s", (name) => {
    expect(ringBodyName(name)).toBeUndefined();
  });
});

describe("commodityFromSaaSignal", () => {
  it.each([
    ["$SAA_SignalType_Painite;", "painite"],
    ["$SAA_SignalType_LowTemperatureDiamond;", "lowtemperaturediamond"],
    ["$SAA_SignalType_Opal;", "opal"],
    ["$SAA_SignalType_Platinum;", "platinum"],
  ])("maps mineral signal %s → %s", (type, id) => {
    expect(commodityFromSaaSignal(type)).toBe(id);
  });

  it.each([
    "$SAA_SignalType_Biological;",
    "$SAA_SignalType_Geological;",
    "$SAA_SignalType_Human;",
    "$SAA_SignalType_Guardian;",
  ])("drops non-mineral signal %s", (type) => {
    expect(commodityFromSaaSignal(type)).toBeUndefined();
  });

  it("tolerates a raw internal name without the SAA wrapper", () => {
    expect(commodityFromSaaSignal("Painite")).toBe("painite");
  });
});

describe("interpretSaaSignals", () => {
  it("returns the ring, parent body, and only the mineral hotspots", () => {
    const result = interpretSaaSignals(
      saa("Paesia 2 A Ring", [
        { type: "$SAA_SignalType_Painite;", count: 2 },
        { type: "$SAA_SignalType_Platinum;", count: 1 },
        { type: "$SAA_SignalType_Geological;", count: 9 }, // filtered
      ]),
    );
    expect(result).toEqual({
      ringName: "Paesia 2 A Ring",
      bodyName: "Paesia 2",
      hotspots: [
        { commodityId: "painite", count: 2 },
        { commodityId: "platinum", count: 1 },
      ],
    });
  });

  it("returns undefined for a planetary surface (not a ring)", () => {
    expect(
      interpretSaaSignals(saa("Nervi 2 A", [{ type: "$SAA_SignalType_Biological;", count: 3 }])),
    ).toBeUndefined();
  });

  it("returns undefined for a ring with no mineral signals", () => {
    expect(
      interpretSaaSignals(
        saa("Nervi 2 A Ring", [{ type: "$SAA_SignalType_Geological;", count: 3 }]),
      ),
    ).toBeUndefined();
  });
});
