import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { buildManifest, buildSessionDetail, emptyManifest } from "./analytics-manifest.js";

let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
  applyMigrations(db, MIGRATIONS);
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
    30000000,
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
    40000000,
    30,
    "ended",
  );
  const r = db.prepare(
    "INSERT INTO refinements (session_id, timestamp, commodity, tons) VALUES (?,?,?,?)",
  );
  r.run(1, "2025-06-01T12:10:00Z", "painite", 20);
  r.run(1, "2025-06-01T12:20:00Z", "platinum", 10);
  r.run(2, "2025-06-02T14:10:00Z", "platinum", 20);
  db.prepare(
    `INSERT INTO prospects (session_id, timestamp, content, remaining_pct, materials, verdict, acted_on)
     VALUES (1, '2025-06-01T12:05:00Z', '$AsteroidMaterialContent_High;', 100, '[]', 'MINE', 1)`,
  ).run();
});
afterEach(() => db.close());

describe("buildManifest", () => {
  it("assembles the full bundle: sessions, aggregate, breakdowns, heatmaps, trend, efficiency, bests", () => {
    const m = buildManifest(db, {});
    expect(m.sessions.map((s) => s.id)).toEqual([2, 1]);
    expect(m.aggregate.tonsRefined).toBe(50);
    expect(m.breakdowns.byRing.map((b) => b.key)).toContain("Paesia 2 A Ring");
    expect(m.heatmaps.ringCommodityYield.cols).toContain("painite");
    expect(m.trend.map((t) => t.sessionId)).toEqual([1, 2]); // chronological
    expect(m.efficiency.limpets.totals.sessions).toBe(2);
    // Personal bests folded from history: best tons/hr is session 2 (40 t/h > 30).
    const tph = m.personalBests.find((b) => b.category === "tons_per_hour");
    expect(tph).toMatchObject({ value: 40, ship: "Cutter" });
  });

  it("honours a filter", () => {
    const m = buildManifest(db, { system: "Paesia" });
    expect(m.sessions.map((s) => s.id)).toEqual([1]);
    expect(m.aggregate.tonsRefined).toBe(30);
  });
});

describe("buildSessionDetail", () => {
  it("returns a session's drill-down, or null for an unknown id", () => {
    const d = buildSessionDetail(db, 1);
    expect(d?.session.id).toBe(1);
    expect(d?.refinements).toEqual([
      { commodity: "painite", tons: 20 },
      { commodity: "platinum", tons: 10 },
    ]);
    expect(buildSessionDetail(db, 999)).toBeNull();
  });
});

describe("emptyManifest", () => {
  it("is a fully-zeroed bundle (the no-database first-run state)", () => {
    const m = emptyManifest();
    expect(m.sessions).toEqual([]);
    expect(m.aggregate.sessions).toBe(0);
    expect(m.breakdowns.byRing).toEqual([]);
    expect(m.heatmaps.timeProductivity.cells).toEqual([]);
    expect(m.trend).toEqual([]);
    expect(m.efficiency.limpets.totals.sessions).toBe(0);
    expect(m.personalBests).toEqual([]);
  });
});
