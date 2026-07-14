import { describe, expect, it } from "vitest";
import { confirmOverlap, detectOverlapCandidate } from "../hotspots/overlaps.js";
import { scoreRing } from "./score.js";
import type { ScoreInput } from "./score.js";
import { DEFAULT_SCORING_WEIGHTS } from "./weights.js";

/** A baseline painite-in-a-pristine-metallic-ring candidate. */
const baseInput: ScoreInput = {
  commodityId: "painite",
  price: 500_000,
  reserve: "Pristine",
  ringType: "Metallic",
};

const score = (over: Partial<ScoreInput>): number => scoreRing({ ...baseInput, ...over }).score;

describe("scoreRing — term breakdown", () => {
  it("reconciles EXACTLY: base is the product, score is base minus penalties", () => {
    const b = scoreRing({ ...baseInput, distanceLy: 40, sellLegLs: 1200 });
    expect(b.base).toBe(b.price * b.overlapMultiplier * b.reserveWeight * b.ringMatch);
    expect(b.score).toBe(b.base - b.distancePenalty - b.sellLegPenalty);
  });

  it("exposes each term for the 'why this score' UI", () => {
    const b = scoreRing(baseInput);
    expect(b).toMatchObject({
      price: 500_000,
      overlapMultiplier: 1,
      reserveWeight: DEFAULT_SCORING_WEIGHTS.reserveWeights.Pristine,
      ringMatch: DEFAULT_SCORING_WEIGHTS.ringMatchHit,
    });
  });

  it("clamps a negative price and negative distances to zero (no penalty)", () => {
    const b = scoreRing({ ...baseInput, price: -100, distanceLy: -5, sellLegLs: -5 });
    expect(b.price).toBe(0);
    expect(b.distancePenalty).toBe(0);
    expect(b.sellLegPenalty).toBe(0);
  });
});

describe("scoreRing — neutral defaults for unknown inputs", () => {
  it("uses the neutral reserve weight for an unknown / absent reserve", () => {
    expect(
      scoreRing({ commodityId: "painite", price: 1, ringType: "Metallic" }).reserveWeight,
    ).toBe(DEFAULT_SCORING_WEIGHTS.reserveUnknown);
    expect(
      scoreRing({ commodityId: "painite", price: 1, reserve: "Bogus", ringType: "Metallic" })
        .reserveWeight,
    ).toBe(DEFAULT_SCORING_WEIGHTS.reserveUnknown);
  });

  it("uses the neutral ring-match for an unknown commodity or an absent ring type", () => {
    expect(scoreRing({ commodityId: "unobtanium", price: 1, ringType: "Metallic" }).ringMatch).toBe(
      DEFAULT_SCORING_WEIGHTS.ringMatchUnknown,
    );
    expect(scoreRing({ commodityId: "painite", price: 1, reserve: "Pristine" }).ringMatch).toBe(
      DEFAULT_SCORING_WEIGHTS.ringMatchUnknown,
    );
  });
});

describe("scoreRing — monotonicity properties", () => {
  it("higher price ⇒ score never decreases", () => {
    const pairs: readonly [number, number][] = [
      [100_000, 200_000],
      [200_000, 800_000],
    ];
    for (const [lo, hi] of pairs) {
      expect(score({ price: hi })).toBeGreaterThanOrEqual(score({ price: lo }));
    }
  });

  it("farther ⇒ score never increases (distance + sell leg)", () => {
    expect(score({ distanceLy: 100 })).toBeLessThanOrEqual(score({ distanceLy: 10 }));
    expect(score({ sellLegLs: 5000 })).toBeLessThanOrEqual(score({ sellLegLs: 100 }));
  });

  it("Pristine ≥ Major ≥ Common ≥ Low ≥ Depleted (all else equal)", () => {
    const pairs: readonly [string, string][] = [
      ["Pristine", "Major"],
      ["Major", "Common"],
      ["Common", "Low"],
      ["Low", "Depleted"],
    ];
    for (const [higher, lower] of pairs) {
      expect(score({ reserve: higher })).toBeGreaterThanOrEqual(score({ reserve: lower }));
    }
  });

  it("a matching ring type outranks a mismatched one", () => {
    expect(score({ ringType: "Metallic" })).toBeGreaterThan(score({ ringType: "Icy" }));
  });

  it("a CONFIRMED overlap outranks the same ring as a candidate, which ties no-overlap", () => {
    const candidate = detectOverlapCandidate([
      { commodityId: "painite", count: 2 },
      { commodityId: "platinum", count: 1 },
    ]);
    if (candidate === undefined) throw new Error("expected a candidate");
    const confirmed = confirmOverlap(candidate, "player-verified");
    const noOverlap = score({});
    const asCandidate = score({ overlap: candidate });
    const asConfirmed = score({ overlap: confirmed });
    expect(asCandidate).toBe(noOverlap); // candidates never boost
    expect(asConfirmed).toBeGreaterThan(asCandidate);
  });
});

describe("scoreRing — golden ranking over a fixture galaxy", () => {
  it("ranks candidates to match the hand-ordered expectation", () => {
    const confirmedTriple = confirmOverlap(
      detectOverlapCandidate([
        { commodityId: "painite", count: 2 },
        { commodityId: "platinum", count: 1 },
        { commodityId: "osmium", count: 1 },
      ]) ?? { commodities: [], multiplicity: 0, confidence: "candidate", source: "x" },
      "player-verified",
    );
    const candidates: { name: string; input: ScoreInput }[] = [
      // A: rich, pristine, confirmed triple overlap, close, near sell — the clear winner.
      {
        name: "A: confirmed-triple pristine, close",
        input: {
          commodityId: "painite",
          price: 700_000,
          reserve: "Pristine",
          ringType: "Metallic",
          overlap: confirmedTriple,
          distanceLy: 15,
          sellLegLs: 300,
        },
      },
      // B: same price, pristine, no overlap, close.
      {
        name: "B: pristine no-overlap, close",
        input: {
          commodityId: "painite",
          price: 700_000,
          reserve: "Pristine",
          ringType: "Metallic",
          distanceLy: 15,
          sellLegLs: 300,
        },
      },
      // C: lower price, major reserve, medium distance.
      {
        name: "C: cheaper, major, medium",
        input: {
          commodityId: "painite",
          price: 400_000,
          reserve: "Major",
          ringType: "Metallic",
          distanceLy: 60,
          sellLegLs: 1500,
        },
      },
      // D: depleted, far, mismatched ring — the worst.
      {
        name: "D: depleted far mismatched",
        input: {
          commodityId: "painite",
          price: 300_000,
          reserve: "Depleted",
          ringType: "Icy",
          distanceLy: 220,
          sellLegLs: 8000,
        },
      },
    ];
    const ranked = candidates
      .map((c) => ({ name: c.name, score: scoreRing(c.input).score }))
      .sort((a, b) => b.score - a.score)
      .map((c) => c.name);
    expect(ranked).toEqual([
      "A: confirmed-triple pristine, close",
      "B: pristine no-overlap, close",
      "C: cheaper, major, medium",
      "D: depleted far mismatched",
    ]);
  });
});
