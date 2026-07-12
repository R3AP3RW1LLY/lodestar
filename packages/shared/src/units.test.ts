import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { addCredits, addLightYears, addTons, credits, lightYears, percent, tons } from "./units.js";
import { isErr, isOk } from "./result.js";
import type { Credits, LightYears, Tons } from "./units.js";

function mustOk<T>(r: { ok: boolean; value?: T }): T {
  if (!r.ok) throw new Error("expected ok");
  return r.value as T;
}

describe("branded units", () => {
  it("tons accepts non-negative finite numbers", () => {
    const r = tons(128.5);
    expect(isOk(r)).toBe(true);
    if (r.ok) expect(r.value).toBe(128.5);
  });

  it("tons rejects negatives, NaN, and infinities with err (never throws)", () => {
    for (const bad of [-1, -0.0001, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = tons(bad);
      expect(isErr(r)).toBe(true);
      if (!r.ok) expect(r.error.code).toBe("unit.invalid-tons");
    }
  });

  it("credits accepts non-negative safe integers and rejects fractions/negatives", () => {
    expect(isOk(credits(0))).toBe(true);
    expect(isOk(credits(1_000_000_000))).toBe(true);
    expect(isOk(credits(Number.MAX_SAFE_INTEGER))).toBe(true);
    for (const bad of [-1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const r = credits(bad);
      expect(isErr(r)).toBe(true);
      if (!r.ok) expect(r.error.code).toBe("unit.invalid-credits");
    }
  });

  it("negative zero normalizes to +0 in every constructor", () => {
    for (const ctor of [tons, credits, percent, lightYears]) {
      const r = ctor(-0);
      expect(r.ok).toBe(true);
      if (r.ok) expect(Object.is(r.value, 0)).toBe(true);
    }
  });

  it("addTons/addLightYears sum valid values; overflow to Infinity returns err", () => {
    const a = mustOk<Tons>(tons(100.5));
    const b = mustOk<Tons>(tons(27.25));
    expect(addTons(a, b)).toEqual(tons(127.75));
    const huge = mustOk<Tons>(tons(Number.MAX_VALUE));
    expect(isErr(addTons(huge, huge))).toBe(true);
    const x = mustOk<LightYears>(lightYears(250));
    const y = mustOk<LightYears>(lightYears(250));
    expect(addLightYears(x, y)).toEqual(lightYears(500));
  });

  it("addCredits rejects sums past MAX_SAFE_INTEGER instead of corrupting", () => {
    const nearMax = mustOk<Credits>(credits(Number.MAX_SAFE_INTEGER - 1));
    const two = mustOk<Credits>(credits(2));
    expect(isErr(addCredits(nearMax, two))).toBe(true);
    expect(addCredits(mustOk<Credits>(credits(40)), mustOk<Credits>(credits(2)))).toEqual(
      credits(42),
    );
  });

  it("percent accepts 0..100 inclusive and rejects outside", () => {
    expect(isOk(percent(0))).toBe(true);
    expect(isOk(percent(100))).toBe(true);
    expect(isOk(percent(32.9))).toBe(true);
    for (const bad of [-0.001, 100.001, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = percent(bad);
      expect(isErr(r)).toBe(true);
      if (!r.ok) expect(r.error.code).toBe("unit.invalid-percent");
    }
  });

  it("lightYears accepts non-negative finite numbers and rejects others", () => {
    expect(isOk(lightYears(0))).toBe(true);
    expect(isOk(lightYears(22_000.75))).toBe(true);
    for (const bad of [-5, Number.NaN, Number.NEGATIVE_INFINITY]) {
      const r = lightYears(bad);
      expect(isErr(r)).toBe(true);
      if (!r.ok) expect(r.error.code).toBe("unit.invalid-light-years");
    }
  });

  it("constructors never throw for any double (property)", () => {
    fc.assert(
      fc.property(fc.double({ noDefaultInfinity: false, noNaN: false }), (n) => {
        for (const ctor of [tons, credits, percent, lightYears]) {
          const r = ctor(n);
          expect(typeof r.ok).toBe("boolean");
        }
      }),
    );
  });

  it("valid constructions round-trip the numeric value exactly (property, all units)", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 100, noNaN: true, noDefaultInfinity: true }), (n) => {
        const p = percent(n);
        expect(p.ok).toBe(true);
        if (p.ok) expect(p.value).toBe(n);
      }),
    );
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e9, noNaN: true, noDefaultInfinity: true }),
        (n) => {
          for (const ctor of [tons, lightYears]) {
            const r = ctor(n);
            expect(r.ok).toBe(true);
            if (r.ok) expect(r.value).toBe(n);
          }
        },
      ),
    );
    fc.assert(
      fc.property(fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }), (n) => {
        const r = credits(n);
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value).toBe(n);
      }),
    );
  });
});
