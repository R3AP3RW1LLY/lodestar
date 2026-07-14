import { describe, expect, it } from "vitest";
import { planRun, rankPlans } from "./run-planner.js";
import type { PlanInput, RunCandidate } from "./run-planner.js";
import { PLAN_STRATEGIES, planComparator } from "./strategies.js";

const INPUT: PlanInput = { cargoCapacity: 256, secondsPerJump: 45 };

const candidate = (over: Partial<RunCandidate>): RunCandidate => ({
  ringName: "Paesia 2 A Ring",
  commodityId: "painite",
  systemName: "Paesia",
  hotspotScore: 500_000,
  miningTph: 200,
  sellStation: "Nemere Terminal",
  sellSystem: "Paesia",
  sellPrice: 500_000,
  outboundLegs: [{ from: "Paesia", to: "Sell", distanceLy: 40, jumps: 5 }],
  returnLegs: [{ from: "Sell", to: "Paesia", distanceLy: 40, jumps: 5 }],
  minSecurity: 0.5,
  ...over,
});

describe("planRun — estimate math (golden)", () => {
  it("computes fill + travel time, cargo value, and effective tph/cph exactly", () => {
    const plan = planRun(candidate({ miningTph: 200, sellPrice: 1_000_000 }), INPUT);
    // fill = 256/200 h = 4608 s ; travel = 10 jumps × 45 s = 450 s
    expect(plan.fillTimeSec).toBeCloseTo(4608);
    expect(plan.totalJumps).toBe(10);
    expect(plan.travelTimeSec).toBe(450);
    expect(plan.totalTimeSec).toBeCloseTo(5058);
    expect(plan.cargoValue).toBe(256_000_000);
    // effective over the whole trip: 256 t / (5058/3600 h)
    expect(plan.estimatedTph).toBeCloseTo(256 / (5058 / 3600));
    expect(plan.estimatedCph).toBeCloseTo(256_000_000 / (5058 / 3600));
  });

  it("guards divide-by-zero (0 tph, 0 cargo, 0 total time) without NaN/Infinity", () => {
    const a = planRun(candidate({ miningTph: 0 }), INPUT);
    expect(Number.isFinite(a.estimatedCph)).toBe(true);
    // Zero cargo AND zero jumps → totalTimeSec 0 → the `|| 1e-9` hours guard.
    const b = planRun(candidate({ outboundLegs: [], returnLegs: [] }), {
      cargoCapacity: 0,
      secondsPerJump: 45,
    });
    expect(b.cargoValue).toBe(0);
    expect(b.totalTimeSec).toBe(0);
    expect(Number.isFinite(b.estimatedTph)).toBe(true);
  });
});

const legs = (jumps: number) => [{ from: "a", to: "b", distanceLy: jumps * 8, jumps }];

describe("rankPlans — strategy orderings (golden fixture galaxy)", () => {
  // P: best profit (highest price). T: fastest (high tph, few jumps). S: safest (high min-sec).
  const P = candidate({
    ringName: "P",
    sellPrice: 1_000_000,
    miningTph: 200,
    outboundLegs: legs(5),
    returnLegs: legs(5),
    minSecurity: 0.4,
  });
  const T = candidate({
    ringName: "T",
    sellPrice: 400_000,
    miningTph: 400,
    outboundLegs: legs(1),
    returnLegs: legs(1),
    minSecurity: 0.4,
  });
  const S = candidate({
    ringName: "S",
    sellPrice: 600_000,
    miningTph: 200,
    outboundLegs: legs(3),
    returnLegs: legs(3),
    minSecurity: 0.9,
  });
  const galaxy = [S, T, P]; // deliberately unordered

  it("max-profit ranks by cr/hr", () => {
    expect(rankPlans(galaxy, INPUT, "max-profit").map((p) => p.candidate.ringName)).toEqual([
      "P",
      "T",
      "S",
    ]);
  });

  it("min-time ranks by total duration", () => {
    expect(rankPlans(galaxy, INPUT, "min-time").map((p) => p.candidate.ringName)).toEqual([
      "T",
      "S",
      "P",
    ]);
  });

  it("safest ranks by minimum route security, then fewest jumps", () => {
    expect(rankPlans(galaxy, INPUT, "safest").map((p) => p.candidate.ringName)).toEqual([
      "S",
      "T",
      "P",
    ]);
  });

  it("exposes the three strategies", () => {
    expect(PLAN_STRATEGIES).toEqual(["max-profit", "min-time", "safest"]);
    // The comparator is a pure ordering fn (spot-check symmetry of the profit sort).
    const plans = rankPlans(galaxy, INPUT, "max-profit");
    expect([...plans].sort(planComparator("max-profit"))).toEqual(plans);
  });

  it("breaks a safest tie (equal min-security) on the fewest jumps", () => {
    const many = candidate({
      ringName: "many",
      minSecurity: 0.9,
      outboundLegs: legs(5),
      returnLegs: legs(5),
    });
    const few = candidate({
      ringName: "few",
      minSecurity: 0.9, // same security → tiebreak on jumps
      outboundLegs: legs(1),
      returnLegs: legs(1),
    });
    expect(rankPlans([many, few], INPUT, "safest")[0]?.candidate.ringName).toBe("few");
  });
});
