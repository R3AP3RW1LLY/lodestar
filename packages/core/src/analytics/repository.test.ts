import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createAnalyticsRepository } from "./repository.js";
import {
  PROSPECT_SUMMARY_SQL,
  REFINEMENTS_BY_COMMODITY_SQL,
  listSessionsSql,
} from "./repository.js";
import { buildSessionWhere } from "./aggregates.js";

/**
 * Seed two ENDED sessions with hand-computed totals + one ACTIVE session:
 *  - S1 Paesia   12:00→13:00 (1h): 30 t (painite 20 + platinum 10), 30 Mcr, 40 limpets;
 *    prospects: 3 MINE + 1 SKIP, 1 motherlode, 2 acted-on.
 *  - S2 Hyades   14:00→14:30 (0.5h): 20 t (platinum 20), 40 Mcr, 30 limpets;
 *    prospects: 2 MINE, 1 motherlode, 2 acted-on.
 *  - S3 Paesia   active: 5 t (painite), 1 SKIP prospect — excluded from history/aggregates.
 */
function seed(db: Db): void {
  const s = db.prepare(
    `INSERT INTO sessions (id, started_at, ended_at, cmdr, ship, system, body, ring,
       tons_refined, credits_earned, limpets_launched, limpets_collected, status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  s.run(
    1,
    "2025-06-01T12:00:00Z",
    "2025-06-01T13:00:00Z",
    "CMDR",
    "Python",
    "Paesia",
    "Paesia 2 A",
    "Paesia 2 A Ring",
    30,
    30_000_000,
    40,
    38,
    "ended",
  );
  s.run(
    2,
    "2025-06-02T14:00:00Z",
    "2025-06-02T14:30:00Z",
    "CMDR",
    "Cutter",
    "Hyades",
    "B 1",
    "Hyades B 1 A Ring",
    20,
    40_000_000,
    30,
    28,
    "ended",
  );
  s.run(
    3,
    "2025-06-03T15:00:00Z",
    null,
    "CMDR",
    "Python",
    "Paesia",
    "Paesia 2 A",
    "Paesia 2 A Ring",
    5,
    0,
    8,
    6,
    "active",
  );

  const r = db.prepare(
    "INSERT INTO refinements (session_id, timestamp, commodity, tons) VALUES (?,?,?,?)",
  );
  r.run(1, "2025-06-01T12:10:00Z", "painite", 20);
  r.run(1, "2025-06-01T12:20:00Z", "platinum", 10);
  r.run(2, "2025-06-02T14:10:00Z", "platinum", 20);
  r.run(3, "2025-06-03T15:10:00Z", "painite", 5);

  const p = db.prepare(
    `INSERT INTO prospects (session_id, timestamp, content, remaining_pct, motherlode, materials, cracked, verdict, reasoning, acted_on)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  p.run(
    1,
    "2025-06-01T12:05:00Z",
    "$AsteroidMaterialContent_High;",
    100,
    "painite",
    "[]",
    0,
    "MINE",
    "[]",
    1,
  );
  p.run(
    1,
    "2025-06-01T12:06:00Z",
    "$AsteroidMaterialContent_High;",
    100,
    null,
    "[]",
    0,
    "MINE",
    "[]",
    1,
  );
  p.run(
    1,
    "2025-06-01T12:07:00Z",
    "$AsteroidMaterialContent_Medium;",
    100,
    null,
    "[]",
    0,
    "MINE",
    "[]",
    0,
  );
  p.run(
    1,
    "2025-06-01T12:08:00Z",
    "$AsteroidMaterialContent_Low;",
    100,
    null,
    "[]",
    0,
    "SKIP",
    "[]",
    0,
  );
  p.run(
    2,
    "2025-06-02T14:05:00Z",
    "$AsteroidMaterialContent_High;",
    100,
    "platinum",
    "[]",
    0,
    "MINE",
    "[]",
    1,
  );
  p.run(
    2,
    "2025-06-02T14:06:00Z",
    "$AsteroidMaterialContent_High;",
    100,
    null,
    "[]",
    0,
    "MINE",
    "[]",
    1,
  );
  p.run(
    3,
    "2025-06-03T15:05:00Z",
    "$AsteroidMaterialContent_Low;",
    100,
    null,
    "[]",
    0,
    "SKIP",
    "[]",
    0,
  );
}

describe("AnalyticsRepository", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    seed(db);
  });
  afterEach(() => {
    db.close();
  });

  it("lists ENDED sessions newest-first with computed rates + prospect counts", () => {
    const repo = createAnalyticsRepository(db);
    const list = repo.listSessions();
    expect(list.map((s) => s.id)).toEqual([2, 1]); // active S3 excluded, id DESC
    const s2 = list[0];
    expect(s2?.tonsRefined).toBe(20);
    expect(s2?.durationSec).toBe(1800);
    expect(s2?.tonsPerHour).toBeCloseTo(40);
    expect(s2?.creditsPerHour).toBeCloseTo(80_000_000);
    expect(s2?.prospected).toBe(2);
    expect(s2?.mineVerdicts).toBe(2);
    const s1 = list[1];
    expect(s1?.tonsPerHour).toBeCloseTo(30);
    expect(s1?.creditsPerHour).toBeCloseTo(30_000_000);
    expect(s1?.prospected).toBe(4);
    expect(s1?.mineVerdicts).toBe(3);
  });

  it("computes cross-session aggregates as hand-computed goldens", () => {
    const agg = createAnalyticsRepository(db).aggregate();
    expect(agg.sessions).toBe(2);
    expect(agg.tonsRefined).toBe(50);
    expect(agg.creditsEarned).toBe(70_000_000);
    expect(agg.limpetsLaunched).toBe(70);
    expect(agg.totalDurationSec).toBe(5400);
    expect(agg.avgTonsPerHour).toBeCloseTo((50 * 3600) / 5400); // 33.333…
    expect(agg.avgCreditsPerHour).toBeCloseTo((70_000_000 * 3600) / 5400);
    expect(agg.prospected).toBe(6);
    expect(agg.mineVerdicts).toBe(5);
    expect(agg.hitRate).toBeCloseTo(5 / 6);
  });

  it("filters by system, ring, commodity, and date range", () => {
    const repo = createAnalyticsRepository(db);
    expect(repo.listSessions({ system: "Paesia" }).map((s) => s.id)).toEqual([1]); // S3 Paesia but active
    expect(repo.listSessions({ ring: "Hyades B 1 A Ring" }).map((s) => s.id)).toEqual([2]);
    expect(repo.listSessions({ commodity: "platinum" }).map((s) => s.id)).toEqual([2, 1]);
    expect(repo.listSessions({ commodity: "painite" }).map((s) => s.id)).toEqual([1]);
    expect(repo.listSessions({ from: "2025-06-02T00:00:00Z" }).map((s) => s.id)).toEqual([2]);
    expect(repo.listSessions({ to: "2025-06-01T23:59:59Z" }).map((s) => s.id)).toEqual([1]);
    // Aggregate honours the same filter.
    expect(repo.aggregate({ system: "Paesia" }).tonsRefined).toBe(30);
  });

  it("returns per-session detail (any status) with commodity breakdown + prospect summary", () => {
    const repo = createAnalyticsRepository(db);
    const d1 = repo.sessionDetail(1);
    expect(d1?.session.id).toBe(1);
    expect(d1?.refinements).toEqual([
      { commodity: "painite", tons: 20 },
      { commodity: "platinum", tons: 10 },
    ]);
    expect(d1?.prospected).toBe(4);
    expect(d1?.mineVerdicts).toBe(3);
    expect(d1?.actedOn).toBe(2);
    expect(d1?.motherlodes).toBe(1);
    // The active session is queryable by id (duration 0 → rate 0).
    const d3 = repo.sessionDetail(3);
    expect(d3?.session.durationSec).toBe(0);
    expect(d3?.session.tonsPerHour).toBe(0);
    expect(repo.sessionDetail(999)).toBeUndefined();
  });

  it("returns a chronological trend series (oldest first) of ended sessions", () => {
    const trend = createAnalyticsRepository(db).trend();
    expect(trend.map((t) => t.sessionId)).toEqual([1, 2]);
    expect(trend[0]?.tonsPerHour).toBeCloseTo(30);
    expect(trend[1]?.tonsPerHour).toBeCloseTo(40);
  });

  it("hot queries touch the large child tables via their indexes (no full scan)", () => {
    const plan = (sql: string, params: Record<string, unknown> = {}): string =>
      (db.prepare("EXPLAIN QUERY PLAN " + sql).all(params) as { detail: string }[])
        .map((r) => r.detail)
        .join(" | ");

    // The session list with a commodity filter: the prospect-count subqueries use
    // idx_prospects_session and the commodity EXISTS uses idx_refinements_session.
    const where = buildSessionWhere({ commodity: "platinum" });
    const listPlan = plan(listSessionsSql(where.sql), { ...where.params, limit: -1 });
    expect(listPlan).toContain("idx_prospects_session");
    expect(listPlan).toContain("idx_refinements_session");

    // Per-session detail queries seek by session_id via their indexes.
    expect(plan(REFINEMENTS_BY_COMMODITY_SQL, { id: 1 })).toContain("idx_refinements_session");
    expect(plan(PROSPECT_SUMMARY_SQL, { id: 1 })).toContain("idx_prospects_session");
  });
});
