import { describe, expect, it } from "vitest";
import { initialRootState } from "./state.js";
import type { RootState } from "./state.js";
import { applyStateDelta, deepEqual, diffRootState } from "./state-delta.js";

describe("deepEqual", () => {
  it("compares primitives, arrays, and nested objects by value", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(true);
    expect(deepEqual({ a: 1, b: [1, 2] }, { a: 1, b: [1, 3] })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual([1, 2, 3], [1, 2])).toBe(false);
    // distinct references, equal values
    expect(deepEqual({ x: { y: 1 } }, { x: { y: 1 } })).toBe(true);
  });
});

describe("diffRootState", () => {
  it("returns an empty delta for structurally equal states (fresh objects)", () => {
    const a = initialRootState();
    const b = initialRootState(); // different reference, same value
    expect(diffRootState(a, b)).toEqual({});
  });

  it("carries only the changed top-level keys, with the next value", () => {
    const prev = initialRootState();
    const next: RootState = {
      ...prev,
      activity: "mining",
      cargo: { count: 2, items: [{ name: "painite", count: 2 }] },
      timestamp: "2025-06-01T12:00:00Z",
    };
    const delta = diffRootState(prev, next);
    expect(delta).toEqual({
      activity: "mining",
      cargo: { count: 2, items: [{ name: "painite", count: 2 }] },
      timestamp: "2025-06-01T12:00:00Z",
    });
    expect(delta.ship).toBeUndefined(); // unchanged → omitted
  });

  it("omits keys that are still undefined (no spurious removal signal)", () => {
    const prev = initialRootState();
    const next: RootState = { ...prev, timestamp: "2025-06-01T12:00:00Z" };
    const delta = diffRootState(prev, next);
    expect(Object.hasOwn(delta, "flags")).toBe(false);
    expect(Object.hasOwn(delta, "pips")).toBe(false);
    expect(delta).toEqual({ timestamp: "2025-06-01T12:00:00Z" });
  });

  it("applyStateDelta is the exact inverse of diffRootState", () => {
    const prev = initialRootState();
    const next: RootState = {
      ...prev,
      activity: "supercruise",
      location: { docked: false, system: "Paesia", body: "Paesia 2 A Ring" },
      flags2: {
        onFoot: false,
        inTaxi: false,
        inMulticrew: false,
        onFootInStation: false,
        onFootOnPlanet: false,
        glideMode: false,
        onFootInHangar: false,
        onFootSocialSpace: false,
        onFootExterior: false,
        breathableAtmosphere: false,
      },
      timestamp: "2025-06-01T12:05:00Z",
    };
    const delta = diffRootState(prev, next);
    expect(applyStateDelta(prev, delta)).toEqual(next);
  });
});
