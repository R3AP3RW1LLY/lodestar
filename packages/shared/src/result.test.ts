import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  andThen,
  err,
  fromPromise,
  fromThrowable,
  isErr,
  isOk,
  map,
  mapErr,
  ok,
  unwrapOr,
} from "./result.js";

describe("Result", () => {
  it("ok wraps a value and is discriminated by ok: true", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    expect(r.value).toBe(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
  });

  it("err wraps an error and is discriminated by ok: false", () => {
    const r = err("boom");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("boom");
    expect(isErr(r)).toBe(true);
    expect(isOk(r)).toBe(false);
  });

  it("map transforms ok values and passes err through untouched", () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    const e = err("nope");
    expect(map<number, number, string>(e, (n) => n * 3)).toBe(e);
  });

  it("mapErr transforms err values and passes ok through untouched", () => {
    expect(mapErr(err("a"), (s) => `${s}!`)).toEqual(err("a!"));
    const o = ok(1);
    expect(mapErr<number, string, string>(o, (s) => `${s}!`)).toBe(o);
  });

  it("andThen chains ok into the next fallible step", () => {
    const half = (n: number) => (n % 2 === 0 ? ok(n / 2) : err("odd"));
    expect(andThen(ok(8), half)).toEqual(ok(4));
    expect(andThen(ok(3), half)).toEqual(err("odd"));
    const e = err("early");
    expect(andThen<number, number, string>(e, half)).toBe(e);
  });

  it("unwrapOr returns the value for ok and the fallback for err", () => {
    expect(unwrapOr(ok(5), 0)).toBe(5);
    expect(unwrapOr(err("x"), 0)).toBe(0);
  });

  it("unwrapOr branches on .ok, not truthiness — falsy ok values are returned", () => {
    expect(unwrapOr(ok(0), 99)).toBe(0);
    expect(unwrapOr(ok(""), "fallback")).toBe("");
    expect(unwrapOr(ok(false), true)).toBe(false);
    expect(unwrapOr<number | null, string>(ok(null), 1)).toBe(null);
  });

  it("fromThrowable returns ok for a value and err via the mapper for a throw", () => {
    expect(fromThrowable(() => JSON.parse('{"a":1}') as unknown, () => "bad")).toEqual(
      ok({ a: 1 }),
    );
    const r = fromThrowable(
      () => JSON.parse("{nope") as unknown,
      (thrown) => (thrown instanceof Error ? thrown.name : "unknown"),
    );
    expect(r).toEqual(err("SyntaxError"));
  });

  it("fromPromise resolves ok and maps rejection into err (never rejects)", async () => {
    await expect(fromPromise(Promise.resolve(3), () => "bad")).resolves.toEqual(ok(3));
    await expect(
      fromPromise(Promise.reject(new Error("nope")), (t) => (t instanceof Error ? t.message : "?")),
    ).resolves.toEqual(err("nope"));
  });

  it("map/andThen obey identity and composition laws (property)", () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        expect(map(ok(n), (v) => v)).toEqual(ok(n));
        const f = (v: number) => v + 1;
        const g = (v: number) => v * 2;
        expect(map(map(ok(n), f), g)).toEqual(ok(g(f(n))));
        expect(andThen(ok(n), (v) => ok(f(v)))).toEqual(ok(f(n)));
      }),
    );
  });
});
