import { describe, expect, it } from "vitest";
import { causeChain, domainError, toWireError, toWireResult } from "./errors.js";
import { err, ok } from "./result.js";

describe("DomainError", () => {
  it("carries a stable code and human message", () => {
    const e = domainError("journal.not-found", "Journal directory not found");
    expect(e.code).toBe("journal.not-found");
    expect(e.message).toBe("Journal directory not found");
    expect(e.cause).toBeUndefined();
  });

  it("chains causes and causeChain lists outermost-first", () => {
    const root = domainError("fs.read-failed", "EACCES reading file");
    const mid = domainError("journal.tail-failed", "Could not tail journal", root);
    const top = domainError("session.start-failed", "Session could not start", mid);
    expect(causeChain(top)).toEqual([
      "session.start-failed: Session could not start",
      "journal.tail-failed: Could not tail journal",
      "fs.read-failed: EACCES reading file",
    ]);
  });

  it("causeChain of a root error is a single entry", () => {
    expect(causeChain(domainError("a", "b"))).toEqual(["a: b"]);
  });

  it("causeChain terminates on a manufactured cycle instead of hanging", () => {
    const a = domainError("a", "first") as { cause?: unknown };
    const b = domainError("b", "second", a as never) as { cause?: unknown };
    a.cause = b; // only constructible by casting past readonly — defense in depth
    const chain = causeChain(a as never);
    expect(chain.length).toBe(65);
    expect(chain.at(-1)).toBe("...(cause chain truncated)");
  });

  it("toWireError flattens the chain for IPC (no class instances)", () => {
    const root = domainError("inner", "root cause");
    const e = domainError("outer", "outer message", root);
    const wire = toWireError(e);
    expect(wire).toEqual({
      code: "outer",
      message: "outer message",
      causeChain: ["outer: outer message", "inner: root cause"],
    });
    expect(Object.getPrototypeOf(wire)).toBe(Object.prototype);
  });

  it("toWireResult maps ok and err to the §5.6 wire envelope", () => {
    expect(toWireResult(ok(7))).toEqual({ ok: true, value: 7 });
    const e = domainError("nope", "refused");
    expect(toWireResult(err(e))).toEqual({
      ok: false,
      error: { code: "nope", message: "refused", causeChain: ["nope: refused"] },
    });
  });
});
