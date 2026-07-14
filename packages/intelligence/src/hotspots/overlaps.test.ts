import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAP_WEIGHTS,
  confirmOverlap,
  detectOverlapCandidate,
  overlapMultiplier,
} from "./overlaps.js";
import type { RingOverlap } from "./overlaps.js";

const hs = (commodityId: string, count: number): { commodityId: string; count: number } => ({
  commodityId,
  count,
});

describe("detectOverlapCandidate", () => {
  it("flags a candidate when ≥2 distinct commodities share a ring (unranked, no likelihood)", () => {
    const candidate = detectOverlapCandidate([hs("platinum", 3), hs("painite", 1)]);
    expect(candidate).toEqual<RingOverlap>({
      commodities: ["painite", "platinum"], // sorted, deterministic
      multiplicity: 2,
      confidence: "candidate",
      source: "journal",
    });
  });

  it("dedupes repeated commodities and needs ≥2 DISTINCT to be a candidate", () => {
    expect(detectOverlapCandidate([hs("painite", 2), hs("painite", 3)])).toBeUndefined();
  });

  it("returns undefined for a single-commodity ring or an empty ring", () => {
    expect(detectOverlapCandidate([hs("painite", 2)])).toBeUndefined();
    expect(detectOverlapCandidate([])).toBeUndefined();
  });

  it("carries a caller-supplied source (e.g. community)", () => {
    const candidate = detectOverlapCandidate([hs("opal", 1), hs("alexandrite", 1)], "community");
    expect(candidate?.source).toBe("community");
  });
});

describe("confirmOverlap", () => {
  const base = detectOverlapCandidate([hs("painite", 2), hs("platinum", 1)]) as RingOverlap;

  it("promotes a candidate to confirmed, keeping commodities + multiplicity", () => {
    const confirmed = confirmOverlap(base, "player-verified");
    expect(confirmed).toEqual<RingOverlap>({
      commodities: ["painite", "platinum"],
      multiplicity: 2,
      confidence: "confirmed",
      source: "player-verified",
    });
  });

  it("keeps the original source when none is supplied", () => {
    expect(confirmOverlap(base).source).toBe(base.source);
  });

  it("is idempotent on an already-confirmed overlap", () => {
    const once = confirmOverlap(base, "player-verified");
    expect(confirmOverlap(once)).toEqual(once);
  });
});

describe("overlapMultiplier", () => {
  const confirmed = (multiplicity: number): RingOverlap => ({
    commodities: Array.from({ length: multiplicity }, (_, i) => `c${String(i)}`),
    multiplicity,
    confidence: "confirmed",
    source: "player-verified",
  });
  const candidate = (multiplicity: number): RingOverlap => ({
    ...confirmed(multiplicity),
    confidence: "candidate",
  });

  it("gives candidates NO boost — always exactly 1.0, whatever the multiplicity", () => {
    expect(overlapMultiplier(candidate(2))).toBe(1);
    expect(overlapMultiplier(candidate(3))).toBe(1);
    expect(overlapMultiplier(candidate(9))).toBe(1);
  });

  it("boosts confirmed overlaps by multiplicity, clamped at the table's max", () => {
    expect(overlapMultiplier(confirmed(2))).toBe(DEFAULT_OVERLAP_WEIGHTS.byMultiplicity[2]);
    expect(overlapMultiplier(confirmed(3))).toBe(DEFAULT_OVERLAP_WEIGHTS.byMultiplicity[3]);
    const max = DEFAULT_OVERLAP_WEIGHTS.byMultiplicity.at(-1);
    expect(overlapMultiplier(confirmed(99))).toBe(max);
  });

  it("a single-commodity confirmed 'overlap' is not a boost (1.0)", () => {
    expect(overlapMultiplier(confirmed(1))).toBe(1);
  });

  it("degrades to no-boost (1.0) if the weights table is empty (never NaN/crash)", () => {
    expect(overlapMultiplier(confirmed(2), { version: 1, byMultiplicity: [], note: "empty" })).toBe(
      1,
    );
  });

  it("is monotonic non-decreasing in multiplicity for confirmed overlaps", () => {
    for (let m = 1; m < 8; m++) {
      expect(overlapMultiplier(confirmed(m + 1))).toBeGreaterThanOrEqual(
        overlapMultiplier(confirmed(m)),
      );
    }
  });

  it("a confirmed overlap always outranks the same ring left as a candidate", () => {
    for (let m = 2; m <= 4; m++) {
      expect(overlapMultiplier(confirmed(m))).toBeGreaterThan(overlapMultiplier(candidate(m)));
    }
  });
});

describe("DEFAULT_OVERLAP_WEIGHTS", () => {
  it("is versioned, monotonic, and carries a provenance note", () => {
    expect(DEFAULT_OVERLAP_WEIGHTS.version).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_OVERLAP_WEIGHTS.note.length).toBeGreaterThan(0);
    const w = DEFAULT_OVERLAP_WEIGHTS.byMultiplicity;
    for (let i = 1; i < w.length; i++) {
      expect(w[i] ?? 0).toBeGreaterThanOrEqual(w[i - 1] ?? 0);
    }
  });
});
