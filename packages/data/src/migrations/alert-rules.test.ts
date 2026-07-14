import { describe, expect, it } from "vitest";
import { openDatabase } from "../db.js";
import { applyMigrations } from "../migrator.js";
import { MIGRATIONS } from "./index.js";

describe("migration 007 — alert_rules", () => {
  it("applies cleanly over a DB already holding Phase 2–6 data", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS.slice(0, 6)); // through galaxy
    db.prepare(
      `INSERT INTO market_snapshots (commodity_id, market_id, sell_price, source, source_ts)
       VALUES ('painite', 1, 500000, 'eddn', '2025-06-01T00:00:00Z')`,
    ).run();

    const result = applyMigrations(db, MIGRATIONS);
    expect(result.atVersion).toBe(7);

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables).toContain("alert_rules");

    // The CHECK constraints hold and a row round-trips.
    db.prepare(
      `INSERT INTO alert_rules (kind, threshold, direction, created_at)
       VALUES ('price-threshold', 500000, 'above', '2025-06-01T00:00:00Z')`,
    ).run();
    expect((db.prepare("SELECT COUNT(*) AS n FROM alert_rules").get() as { n: number }).n).toBe(1);
    expect(() =>
      db
        .prepare("INSERT INTO alert_rules (kind, threshold, created_at) VALUES ('bogus', 1, 't')")
        .run(),
    ).toThrow(); // CHECK (kind IN …)
    db.close();
  });
});
