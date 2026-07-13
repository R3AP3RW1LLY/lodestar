import { describe, expect, it } from "vitest";
import { DASH, fmtCredits, fmtInt, fmtNum, fmtText } from "./format.js";

describe("format helpers", () => {
  it("fmtInt rounds and groups; undefined → dash", () => {
    expect(fmtInt(2500000)).toBe("2,500,000");
    expect(fmtInt(4.6)).toBe("5");
    expect(fmtInt(undefined)).toBe(DASH);
  });

  it("fmtNum fixes decimals; undefined → dash", () => {
    expect(fmtNum(22.222, 1)).toBe("22.2");
    expect(fmtNum(22, 2)).toBe("22.00");
    expect(fmtNum(undefined)).toBe(DASH);
  });

  it("fmtCredits appends cr; undefined → dash", () => {
    expect(fmtCredits(11111111)).toBe("11,111,111 cr");
    expect(fmtCredits(undefined)).toBe(DASH);
  });

  it("fmtText passes through; empty/undefined → dash", () => {
    expect(fmtText("python")).toBe("python");
    expect(fmtText("")).toBe(DASH);
    expect(fmtText(undefined)).toBe(DASH);
  });
});
