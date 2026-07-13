import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { parseJournalEvent } from "../journal/events/parse.js";
import { toProspect } from "../journal/events/prospected-asteroid.js";
import type { Prospect } from "../journal/events/prospected-asteroid.js";
import { createProspectRepository } from "./prospect-repository.js";

/** Parse a raw ProspectedAsteroid line into a Prospect observation. */
function prospect(raw: string): Prospect {
  const r = parseJournalEvent(raw);
  if (!r.ok || r.value.event !== "ProspectedAsteroid") {
    throw new Error(`not a ProspectedAsteroid: ${raw}`);
  }
  return toProspect(r.value);
}

const HIGH_PAINITE = `{"timestamp":"2025-06-01T12:05:10Z","event":"ProspectedAsteroid","Materials":[{"Name":"painite","Proportion":24.53125},{"Name":"platinum","Proportion":8.1}],"Content":"$AsteroidMaterialContent_High;","Content_Localised":"High","Remaining":100.0,"MotherlodeMaterial":"painite"}`;
const LOW_RUTILE = `{"timestamp":"2025-06-01T12:05:30Z","event":"ProspectedAsteroid","Materials":[{"Name":"rutile","Proportion":3.21}],"Content":"$AsteroidMaterialContent_Low;","Remaining":100.0}`;
const DEPLETED = `{"timestamp":"2025-06-01T12:06:00Z","event":"ProspectedAsteroid","Materials":[{"Name":"painite","Proportion":20.0}],"Content":"$AsteroidMaterialContent_High;","Remaining":45.5}`;

describe("ProspectRepository (migration 003)", () => {
  let db: Db;
  let sessionId: number;

  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    // A parent session for the FK-keyed prospects.
    sessionId = Number(
      db
        .prepare(
          "INSERT INTO sessions (started_at, status) VALUES ('2025-06-01T12:00:00Z','active')",
        )
        .run().lastInsertRowid,
    );
  });
  afterEach(() => {
    db.close();
  });

  it("migration 003 created the prospects table", () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain("prospects");
  });

  it("round-trips a prospect with all fields (materials, content, remaining, motherlode)", () => {
    const repo = createProspectRepository(db);
    const id = repo.save(prospect(HIGH_PAINITE), sessionId);
    const rows = repo.listBySession(sessionId);
    expect(rows).toHaveLength(1);
    const stored = rows[0];
    expect(stored?.id).toBe(id);
    expect(stored?.sessionId).toBe(sessionId);
    expect(stored?.content).toBe("$AsteroidMaterialContent_High;");
    expect(stored?.remainingPct).toBe(100);
    expect(stored?.motherlode).toBe("painite");
    expect(stored?.materials).toEqual([
      { name: "painite", proportion: 24.53125 },
      { name: "platinum", proportion: 8.1 },
    ]);
    expect(stored?.cracked).toBe(false);
  });

  it("stores a partially-depleted observation (Remaining < 100) as its own row with remaining_pct", () => {
    const repo = createProspectRepository(db);
    repo.save(prospect(HIGH_PAINITE), sessionId); // Remaining 100
    repo.save(prospect(DEPLETED), sessionId); // Remaining 45.5 — an independent observation
    const rows = repo.listBySession(sessionId);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.remainingPct).toBe(100);
    expect(rows[1]?.remainingPct).toBe(45.5);
  });

  it("stores a rock with no motherlode as no motherlode (null → undefined)", () => {
    const repo = createProspectRepository(db);
    repo.save(prospect(LOW_RUTILE), sessionId);
    expect(repo.listBySession(sessionId)[0]?.motherlode).toBeUndefined();
  });

  it("markCracked flags a specific prospect (never a 'most recent' heuristic) — 2.6", () => {
    const repo = createProspectRepository(db);
    const a = repo.save(prospect(HIGH_PAINITE), sessionId);
    const b = repo.save(prospect(DEPLETED), sessionId);
    expect(repo.markCracked(a)).toBe(true); // the OLDER row, not the latest
    const rows = repo.listBySession(sessionId);
    expect(rows[0]?.cracked).toBe(true); // only a
    expect(rows[1]?.cracked).toBe(false); // b untouched
    expect(b).toBeGreaterThan(a);
    expect(repo.markCracked(9999)).toBe(false); // no such row
  });

  it("persists a prospect with no active session (session_id null)", () => {
    const repo = createProspectRepository(db);
    repo.save(prospect(HIGH_PAINITE)); // no session id
    const row = repo.listRecent(1)[0];
    expect(row?.sessionId).toBeUndefined();
    expect(row?.content).toBe("$AsteroidMaterialContent_High;");
  });

  it("enforces the session FK — a prospect for a non-existent session is rejected", () => {
    const repo = createProspectRepository(db);
    expect(() => repo.save(prospect(HIGH_PAINITE), 999)).toThrow();
  });

  it("surfaces a corrupt materials row instead of silently dropping it", () => {
    const repo = createProspectRepository(db);
    repo.save(prospect(HIGH_PAINITE), sessionId);
    db.prepare('UPDATE prospects SET materials = \'{"not":"an array"}\'').run();
    expect(() => repo.listBySession(sessionId)).toThrow(/expected a JSON array/);
  });

  it("a freshly-saved prospect has no verdict and is not acted-on (2.6 columns default)", () => {
    const repo = createProspectRepository(db);
    repo.save(prospect(HIGH_PAINITE), sessionId);
    const row = repo.listBySession(sessionId)[0];
    expect(row?.verdict).toBeUndefined();
    expect(row?.reasoning).toBeUndefined();
    expect(row?.actedOn).toBe(false);
  });

  it("saveVerdict persists the MINE/SKIP call + structured reasoning JSON onto the row (2.6)", () => {
    const repo = createProspectRepository(db);
    const id = repo.save(prospect(HIGH_PAINITE), sessionId);
    const reasoning = JSON.stringify([{ code: "motherlode", commodityId: "painite" }]);
    repo.saveVerdict(id, "MINE", reasoning);
    const row = repo.listBySession(sessionId)[0];
    expect(row?.verdict).toBe("MINE");
    expect(row?.reasoning).toBe(reasoning);
    expect(row?.actedOn).toBe(false); // saving a verdict does not imply acted-on
  });

  it("markActedOn flags the row (idempotent) and reports whether it matched (2.6)", () => {
    const repo = createProspectRepository(db);
    const id = repo.save(prospect(HIGH_PAINITE), sessionId);
    expect(repo.markActedOn(id)).toBe(true);
    expect(repo.listBySession(sessionId)[0]?.actedOn).toBe(true);
    expect(repo.markActedOn(id)).toBe(true); // idempotent — still true, stays 1
    expect(repo.markActedOn(9999)).toBe(false); // no such row
  });
});
