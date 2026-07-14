import { describe, expect, it } from "vitest";
import {
  buildSessionWhere,
  computeAggregates,
  durationSec,
  perHour,
  toSessionListItem,
  toTrendPoint,
} from "./aggregates.js";
import type { RawSessionRow, SessionListItem } from "./aggregates.js";

const item = (over: Partial<SessionListItem> = {}): SessionListItem => ({
  id: 1,
  startedAt: "2025-06-01T12:00:00Z",
  endedAt: "2025-06-01T13:00:00Z",
  ship: "Python",
  system: "Paesia",
  ring: "Paesia 2 A Ring",
  tonsRefined: 30,
  creditsEarned: 30_000_000,
  limpetsLaunched: 40,
  durationSec: 3600,
  tonsPerHour: 30,
  creditsPerHour: 30_000_000,
  prospected: 4,
  mineVerdicts: 3,
  ...over,
});

describe("durationSec", () => {
  it("is the elapsed seconds for an ended session", () => {
    expect(durationSec("2025-06-01T12:00:00Z", "2025-06-01T13:00:00Z")).toBe(3600);
  });
  it("is 0 for an active session, a negative span, or unparseable timestamps", () => {
    expect(durationSec("2025-06-01T12:00:00Z", null)).toBe(0);
    expect(durationSec("2025-06-01T13:00:00Z", "2025-06-01T12:00:00Z")).toBe(0);
    expect(durationSec("nonsense", "2025-06-01T13:00:00Z")).toBe(0);
  });
});

describe("perHour", () => {
  it("scales a total to an hourly rate", () => {
    expect(perHour(30, 3600)).toBe(30);
    expect(perHour(20, 1800)).toBe(40);
  });
  it("is 0 with no elapsed time (never divides by zero)", () => {
    expect(perHour(30, 0)).toBe(0);
  });
});

describe("toSessionListItem", () => {
  it("derives duration + rates from a raw row", () => {
    const row: RawSessionRow = {
      id: 7,
      started_at: "2025-06-01T12:00:00Z",
      ended_at: "2025-06-01T12:30:00Z",
      ship: "Cutter",
      system: "Hyades",
      ring: "R",
      tons_refined: 20,
      credits_earned: 40_000_000,
      limpets_launched: 30,
      prospected: 2,
      mine_verdicts: 2,
    };
    expect(toSessionListItem(row)).toMatchObject({
      id: 7,
      durationSec: 1800,
      tonsPerHour: 40,
      creditsPerHour: 80_000_000,
      prospected: 2,
      mineVerdicts: 2,
    });
  });
});

describe("computeAggregates", () => {
  it("is all-zero for an empty set (no divide-by-zero)", () => {
    expect(computeAggregates([])).toEqual({
      sessions: 0,
      tonsRefined: 0,
      creditsEarned: 0,
      limpetsLaunched: 0,
      totalDurationSec: 0,
      avgTonsPerHour: 0,
      avgCreditsPerHour: 0,
      prospected: 0,
      mineVerdicts: 0,
      hitRate: 0,
    });
  });

  it("totals every session but excludes zero-duration rows from the rate averages", () => {
    const agg = computeAggregates([
      item({ id: 1, tonsRefined: 30, creditsEarned: 30_000_000, durationSec: 3600 }),
      item({ id: 2, tonsRefined: 20, creditsEarned: 40_000_000, durationSec: 1800 }),
      // A zero-duration (e.g. instant/degenerate) row: its tons count, its rate can't.
      item({
        id: 3,
        tonsRefined: 5,
        creditsEarned: 1_000_000,
        durationSec: 0,
        prospected: 0,
        mineVerdicts: 0,
      }),
    ]);
    expect(agg.sessions).toBe(3);
    expect(agg.tonsRefined).toBe(55); // includes the zero-duration row's tons
    expect(agg.totalDurationSec).toBe(5400);
    expect(agg.avgTonsPerHour).toBeCloseTo((50 * 3600) / 5400); // 50 t over 1.5 h, NOT 55
    expect(agg.hitRate).toBeCloseTo(6 / 8);
  });
});

describe("toTrendPoint", () => {
  it("projects the charted fields", () => {
    expect(toTrendPoint(item({ id: 5 }))).toEqual({
      sessionId: 5,
      startedAt: "2025-06-01T12:00:00Z",
      tonsRefined: 30,
      tonsPerHour: 30,
      creditsPerHour: 30_000_000,
    });
  });
});

describe("buildSessionWhere", () => {
  it("scopes to ended sessions with no filter", () => {
    const w = buildSessionWhere({});
    expect(w.sql).toBe("s.status = 'ended'");
    expect(w.params).toEqual({});
  });

  it("AND-combines every provided filter with named params", () => {
    const w = buildSessionWhere({
      from: "2025-06-01",
      to: "2025-06-30",
      system: "Paesia",
      ring: "R",
      commodity: "painite",
    });
    expect(w.sql).toContain("s.started_at >= @from");
    expect(w.sql).toContain("s.started_at <= @to");
    expect(w.sql).toContain("s.system = @system");
    expect(w.sql).toContain("s.ring = @ring");
    // Commodity is a correlated EXISTS so `refinements` is reached via its index.
    expect(w.sql).toContain("EXISTS (SELECT 1 FROM refinements r WHERE r.session_id = s.id");
    expect(w.params).toEqual({
      from: "2025-06-01",
      to: "2025-06-30",
      system: "Paesia",
      ring: "R",
      commodity: "painite",
    });
  });
});
