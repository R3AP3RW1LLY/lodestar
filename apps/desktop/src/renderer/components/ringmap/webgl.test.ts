// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { hasWebGL } from "./webgl.js";

describe("hasWebGL", () => {
  it("is true when a GL context is returned", () => {
    expect(hasWebGL(() => ({}) as WebGLRenderingContext)).toBe(true);
  });
  it("is false when no context is available (fallback path)", () => {
    expect(hasWebGL(() => null)).toBe(false);
  });
  it("is false (never throws) when the probe throws", () => {
    expect(
      hasWebGL(() => {
        throw new Error("no gl");
      }),
    ).toBe(false);
  });
  it("does not crash under the real jsdom probe (no WebGL there → false)", () => {
    expect(hasWebGL()).toBe(false);
  });
});
