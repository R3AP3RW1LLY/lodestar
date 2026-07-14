import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createAnalyticsRepository, DOMINANT_COMMODITY_SQL } from "./repository.js";
import { assembleBreakdowns, foldBreakdown, foldPairings } from "./breakdowns.js";
import type { SessionBreakdownInput } from "./breakdowns.js";

/**
 * Three ENDED sessions (+ one active, excluded). Every session is SINGLE-ring (the
 * tracker splits on ring change), so breakdowns group by the session's one ring:
 *  - S1 Paesia/Python  1h  30 t (painite 20 + platinum 10 → dominant painite) 30 Mcr
 *  - S2 Hyades/Cutter  0.5h 20 t (platinum 20 → dominant platinum)            40 Mcr
 *  - S4 Paesia/Python  1h  40 t (painite 40 → dominant painite)               20 Mcr
 * So Paesia = {S1,S4}: 70 t / 2 h → 35 t/h, 50 Mcr → 25 Mcr/h.
 */
function seed(db: Db): void {
  const s = db.prepare(
    `INSERT INTO sessions (id, started_at, ended_at, ship, system, ring, tons_refined,
       credits_earned, limpets_launched, status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  s.run(
    1,
    "2025-06-01T12:00:00Z",
    "2025-06-01T13:00:00Z",
    "Python",
    "Paesia",
    "Paesia 2 A Ring",
    30,
    30_000_000,
    40,
    "ended",
  );
  s.run(
    2,
    "2025-06-02T14:00:00Z",
    "2025-06-02T14:30:00Z",
    "Cutter",
    "Hyades",
    "Hyades B 1 A Ring",
    20,
    40_000_000,
    30,
    "ended",
  );
  s.run(
    4,
    "2025-06-04T10:00:00Z",
    "2025-06-04T11:00:00Z",
    "Python",
    "Paesia",
    "Paesia 2 A Ring",
    40,
    20_000_000,
    50,
    "ended",
  );
  s.run(3, "2025-06-03T15:00:00Z", null, "Python", "Paesia", "Paesia 2 A Ring", 5, 0, 8, "active");

  const r = db.prepare(
    "INSERT INTO refinements (session_id, timestamp, commodity, tons) VALUES (?,?,?,?)",
  );
  r.run(1, "2025-06-01T12:10:00Z", "painite", 20);
  r.run(1, "2025-06-01T12:20:00Z", "platinum", 10);
  r.run(2, "2025-06-02T14:10:00Z", "platinum", 20);
  r.run(4, "2025-06-04T10:10:00Z", "painite", 40);
  r.run(3, "2025-06-03T15:10:00Z", "painite", 5);
}

const input = (over: Partial<SessionBreakdownInput>): SessionBreakdownInput => ({
  ring: "R",
  ship: "Python",
  commodity: "painite",
  tonsRefined: 10,
  creditsEarned: 1_000_000,
  durationSec: 3600,
  ...over,
});

describe("foldBreakdown (pure)", () => {
  it("groups by the key, sums totals, derives rates, sorts by tons desc", () => {
    const rows = foldBreakdown(
      [
        input({ ring: "A", tonsRefined: 30, creditsEarned: 30_000_000, durationSec: 3600 }),
        input({ ring: "A", tonsRefined: 40, creditsEarned: 20_000_000, durationSec: 3600 }),
        input({ ring: "B", tonsRefined: 20, creditsEarned: 40_000_000, durationSec: 1800 }),
      ],
      (i) => i.ring ?? "Unknown",
    );
    expect(rows.map((r) => r.key)).toEqual(["A", "B"]); // A (70 t) before B (20 t)
    expect(rows[0]).toMatchObject({
      key: "A",
      sessions: 2,
      tonsRefined: 70,
      creditsEarned: 50_000_000,
      durationSec: 7200,
      tonsPerHour: 35,
      creditsPerHour: 25_000_000,
    });
  });

  it("buckets a null key under 'Unknown'", () => {
    const rows = foldBreakdown([input({ ring: null })], (i) => i.ring ?? "Unknown");
    expect(rows[0]?.key).toBe("Unknown");
  });
});

describe("foldPairings (pure)", () => {
  it("groups by ring×commodity and ranks by tons/hr", () => {
    const pairs = foldPairings([
      input({ ring: "Paesia", commodity: "painite", tonsRefined: 70, durationSec: 7200 }),
      input({ ring: "Hyades", commodity: "platinum", tonsRefined: 20, durationSec: 1800 }),
    ]);
    // Hyades/platinum 40 t/h ranks above Paesia/painite 35 t/h.
    expect(pairs.map((p) => [p.ring, p.commodity, p.tonsPerHour])).toEqual([
      ["Hyades", "platinum", 40],
      ["Paesia", "painite", 35],
    ]);
  });
});

describe("AnalyticsRepository.breakdowns", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    seed(db);
  });
  afterEach(() => db.close());

  it("breaks down ENDED sessions by ring / ship / dominant commodity with best pairings", () => {
    const b = createAnalyticsRepository(db).breakdowns();

    expect(b.byRing.map((r) => [r.key, r.sessions, r.tonsRefined, r.tonsPerHour])).toEqual([
      ["Paesia 2 A Ring", 2, 70, 35],
      ["Hyades B 1 A Ring", 1, 20, 40],
    ]);
    expect(b.byShip.find((r) => r.key === "Python")).toMatchObject({
      sessions: 2,
      tonsRefined: 70,
      creditsEarned: 50_000_000,
      tonsPerHour: 35,
    });
    // Dominant commodity: S1 painite (20>10), S4 painite, S2 platinum.
    expect(b.byCommodity.find((r) => r.key === "painite")).toMatchObject({
      sessions: 2,
      tonsRefined: 70,
    });
    // Best pairing ranks Hyades/platinum (40 t/h) over Paesia/painite (35 t/h).
    expect(b.bestPairings.map((p) => [p.ring, p.commodity, p.tonsPerHour])).toEqual([
      ["Hyades B 1 A Ring", "platinum", 40],
      ["Paesia 2 A Ring", "painite", 35],
    ]);
  });

  it("honours a filter (system) and excludes the active session", () => {
    const b = createAnalyticsRepository(db).breakdowns({ system: "Paesia" });
    expect(b.byRing).toHaveLength(1);
    expect(b.byRing[0]).toMatchObject({ key: "Paesia 2 A Ring", sessions: 2, tonsRefined: 70 });
  });

  it("the dominant-commodity query seeks refinements via its index", () => {
    const plan = (
      db.prepare("EXPLAIN QUERY PLAN " + DOMINANT_COMMODITY_SQL).all({ id: 1 }) as {
        detail: string;
      }[]
    )
      .map((r) => r.detail)
      .join(" | ");
    expect(plan).toContain("idx_refinements_session");
  });
});

describe("assembleBreakdowns (pure)", () => {
  it("produces all four views from session inputs", () => {
    const b = assembleBreakdowns([input({ ring: "A", ship: "Python", commodity: "painite" })]);
    expect(b.byRing[0]?.key).toBe("A");
    expect(b.byShip[0]?.key).toBe("Python");
    expect(b.byCommodity[0]?.key).toBe("painite");
    expect(b.bestPairings[0]).toMatchObject({ ring: "A", commodity: "painite" });
  });
});
