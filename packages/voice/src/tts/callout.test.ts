import { describe, expect, it } from "vitest";
import { formatCallout } from "./callout.js";

describe("formatCallout", () => {
  it("speaks the dominant qualifying commodity + rounded proportion for a MINE", () => {
    expect(
      formatCallout({
        call: "MINE",
        reasons: [
          { code: "proportion-above-threshold", display: "Platinum", proportion: 31.6 },
          { code: "price-weighted-value/t" },
        ],
      }),
    ).toBe("Platinum, 32 percent. Mine.");
  });

  it("prefers the motherlode phrasing when present", () => {
    expect(
      formatCallout({
        call: "MINE",
        reasons: [
          { code: "motherlode", display: "Painite" },
          { code: "proportion-above-threshold", display: "Painite", proportion: 12 },
        ],
      }),
    ).toBe("Painite motherlode. Mine.");
  });

  it("says Skip for a SKIP verdict", () => {
    expect(formatCallout({ call: "SKIP", reasons: [{ code: "already-depleted" }] })).toBe("Skip.");
  });

  it("falls back to a bare Mine when no commodity reason is present", () => {
    expect(formatCallout({ call: "MINE", reasons: [{ code: "content-tier" }] })).toBe("Mine.");
  });
});
