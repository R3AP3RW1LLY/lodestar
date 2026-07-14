import { describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createAnalyticsRepository } from "./repository.js";

/**
 * The 1k-session wall-clock benchmark (SSOT Step 3.1 acceptance). This is a
 * DOCUMENTED manual benchmark, NOT a timing gate — CI asserts only that the queries
 * stay functionally correct at 1k sessions; the measured time is logged and recorded
 * in the changelog (a slow CI runner must never flake this). See §4.2.
 */
const N = 1000;
const HOUR_MS = 3_600_000;

function seedMany(db: Db): void {
  const insS = db.prepare(
    `INSERT INTO sessions (started_at, ended_at, ship, system, ring, tons_refined,
       credits_earned, limpets_launched, status)
     VALUES (?,?,?,?,?,?,?,?, 'ended')`,
  );
  const insR = db.prepare(
    "INSERT INTO refinements (session_id, timestamp, commodity, tons) VALUES (?,?,?,?)",
  );
  const insP = db.prepare(
    `INSERT INTO prospects (session_id, timestamp, content, remaining_pct, materials, verdict, acted_on)
     VALUES (?,?,?,?,?,?,?)`,
  );
  const base = Date.UTC(2025, 0, 1, 0, 0, 0);
  const tx = db.transaction(() => {
    for (let i = 0; i < N; i++) {
      const startedAt = new Date(base + i * HOUR_MS).toISOString();
      const endedAt = new Date(base + i * HOUR_MS + 1_800_000).toISOString(); // +30 min
      const system = i % 3 === 0 ? "Paesia" : "Hyades";
      const commodity = i % 2 === 0 ? "painite" : "platinum";
      const sid = Number(
        insS.run(startedAt, endedAt, "Python", system, "R", 20, 40_000_000, 30).lastInsertRowid,
      );
      insR.run(sid, startedAt, commodity, 20);
      for (let k = 0; k < 3; k++) {
        insP.run(
          sid,
          startedAt,
          "$AsteroidMaterialContent_High;",
          100,
          "[]",
          k < 2 ? "MINE" : "SKIP",
          1,
        );
      }
    }
  });
  tx();
}

describe("analytics 1k-session benchmark", () => {
  it("stays functionally correct across list + aggregate + filter + trend on 1k sessions", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    seedMany(db);
    const repo = createAnalyticsRepository(db);

    const t0 = performance.now();
    const list = repo.listSessions();
    const agg = repo.aggregate();
    const filtered = repo.listSessions({ commodity: "painite", system: "Paesia" });
    const trend = repo.trend();
    const elapsedMs = performance.now() - t0;

    expect(list).toHaveLength(N);
    expect(agg.sessions).toBe(N);
    expect(agg.tonsRefined).toBe(N * 20);
    expect(agg.prospected).toBe(N * 3);
    expect(agg.mineVerdicts).toBe(N * 2);
    expect(trend).toHaveLength(N);
    expect(trend[0]?.sessionId).toBe(1); // oldest first
    expect(filtered.length).toBeGreaterThan(0); // Paesia ∧ painite (i % 6 === 0)

    // Recorded, not gated.
    console.info(
      `[analytics benchmark] 1k sessions — list+aggregate+filter+trend in ${elapsedMs.toFixed(1)} ms`,
    );
    db.close();
  });
});
