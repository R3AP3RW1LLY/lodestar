import { describe, expect, it } from "vitest";
import type { ScanEvent } from "@lodestar/shared";
import { interpretRingScan, normalizeReserveLevel, normalizeRingClass } from "./scan.js";

const scan = (
  bodyName: string,
  rings: { name: string; ringClass: string }[] | undefined,
  reserveLevel?: string,
): ScanEvent => ({
  event: "Scan",
  timestamp: "2025-06-01T00:00:00Z",
  bodyName,
  bodyId: 5,
  systemAddress: 1,
  ...(reserveLevel === undefined ? {} : { reserveLevel }),
  ...(rings === undefined
    ? {}
    : { rings: rings.map((r) => ({ ...r, massMt: 1, innerRad: 1, outerRad: 2 })) }),
});

describe("normalizeRingClass", () => {
  it.each([
    ["eRingClass_Metalic", "Metallic"], // the game's misspelling
    ["eRingClass_Metallic", "Metallic"],
    ["eRingClass_MetalRich", "MetalRich"],
    ["eRingClass_Rocky", "Rocky"],
    ["eRingClass_Icy", "Icy"],
    ["Icy", "Icy"], // already bare
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeRingClass(raw)).toBe(expected);
  });
});

describe("normalizeReserveLevel", () => {
  it.each([
    ["PristineResources", "Pristine"],
    ["MajorResources", "Major"],
    ["DepletedResources", "Depleted"],
  ])("normalizes %s → %s", (raw, expected) => {
    expect(normalizeReserveLevel(raw)).toBe(expected);
  });
});

describe("interpretRingScan", () => {
  it("carries ring type + reserve for each true ring", () => {
    const result = interpretRingScan(
      scan(
        "Paesia 2",
        [{ name: "Paesia 2 A Ring", ringClass: "eRingClass_Metalic" }],
        "PristineResources",
      ),
    );
    expect(result).toEqual({
      bodyName: "Paesia 2",
      rings: [{ ringName: "Paesia 2 A Ring", ringType: "Metallic", reserve: "Pristine" }],
    });
  });

  it("omits reserve when the scan has none", () => {
    const result = interpretRingScan(
      scan("Paesia 2", [{ name: "Paesia 2 A Ring", ringClass: "eRingClass_Icy" }]),
    );
    expect(result?.rings[0]).toEqual({ ringName: "Paesia 2 A Ring", ringType: "Icy" });
  });

  it("drops stellar belts, keeping only true rings", () => {
    const result = interpretRingScan(
      scan("Delkar", [
        { name: "Delkar A Belt", ringClass: "eRingClass_Rocky" },
        { name: "Delkar 7 A Ring", ringClass: "eRingClass_Metalic" },
      ]),
    );
    expect(result?.rings.map((r) => r.ringName)).toEqual(["Delkar 7 A Ring"]);
  });

  it("returns undefined for a body with no rings", () => {
    expect(interpretRingScan(scan("Paesia 2", undefined))).toBeUndefined();
    expect(interpretRingScan(scan("Paesia 2", []))).toBeUndefined();
  });

  it("returns undefined for a body with only belts", () => {
    expect(
      interpretRingScan(scan("Delkar", [{ name: "Delkar A Belt", ringClass: "eRingClass_Rocky" }])),
    ).toBeUndefined();
  });
});
