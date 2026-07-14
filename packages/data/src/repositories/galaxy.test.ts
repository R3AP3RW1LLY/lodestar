import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "../index.js";
import type { Db } from "../db.js";
import {
  HOTSPOTS_BY_COMMODITY_SQL,
  RINGS_BY_SYSTEM_SQL,
  SYSTEMS_WITHIN_SQL,
  createSystemRepository,
} from "./index.js";

const explain = (db: Db, sql: string, params: Record<string, unknown> = {}): string =>
  (db.prepare("EXPLAIN QUERY PLAN " + sql).all(params) as { detail: string }[])
    .map((r) => r.detail)
    .join(" | ");

describe("migration 006 — galaxy", () => {
  it("applies cleanly over a DB already holding Phase-2 data, additively extending market_snapshots", () => {
    const db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS.slice(0, 5)); // through personal-bests
    db.prepare(
      `INSERT INTO market_snapshots (commodity_id, market_id, sell_price, source, source_ts, star_system)
       VALUES ('painite', 1, 500000, 'journal', '2025-06-01T12:00:00Z', 'Paesia')`,
    ).run();

    const result = applyMigrations(db, MIGRATIONS); // applies v6 over the populated DB
    expect(result.atVersion).toBe(6);

    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "systems",
        "bodies",
        "rings",
        "stations",
        "hotspots",
        "overlaps",
        "runs",
      ]),
    );

    // The ADD COLUMNs exist and the pre-existing row survived untouched.
    const row = db
      .prepare(
        "SELECT commodity_id, sell_price, pad_size, demand FROM market_snapshots WHERE market_id = 1",
      )
      .get() as {
      commodity_id: string;
      sell_price: number;
      pad_size: string | null;
      demand: number | null;
    };
    expect(row).toEqual({
      commodity_id: "painite",
      sell_price: 500000,
      pad_size: null,
      demand: null,
    });
    db.close();
  });
});

describe("SystemRepository", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
  });
  afterEach(() => db.close());

  it("upserts by name (insert then update the same row) and looks up by id/name", () => {
    const repo = createSystemRepository(db);
    const id = repo.upsert({ name: "Sol", x: 0, y: 0, z: 0 }, "2025-06-01T00:00:00Z");
    expect(repo.byName("Sol")?.id).toBe(id);
    const id2 = repo.upsert(
      { name: "Sol", x: 1, y: 2, z: 3, address: 10_477_373_803 },
      "2025-06-02T00:00:00Z",
    );
    expect(id2).toBe(id); // same row, not a duplicate
    expect(repo.byId(id)).toMatchObject({
      x: 1,
      y: 2,
      z: 3,
      address: 10_477_373_803,
      updatedAt: "2025-06-02T00:00:00Z",
    });
  });

  it("within() returns systems inside the radius, nearest first, with distances", () => {
    const repo = createSystemRepository(db);
    repo.upsert({ name: "A", x: 0, y: 0, z: 0 }, "t");
    repo.upsert({ name: "B", x: 3, y: 4, z: 0 }, "t"); // 5 ly
    repo.upsert({ name: "C", x: 30, y: 0, z: 0 }, "t"); // 30 ly — outside a 10 ly search
    const near = repo.within({ x: 0, y: 0, z: 0 }, 10);
    expect(near.map((s) => s.name)).toEqual(["A", "B"]);
    expect(near[0]?.distanceLy).toBeCloseTo(0);
    expect(near[1]?.distanceLy).toBeCloseTo(5);
  });

  it("hot queries use their indexes (no full scan)", () => {
    expect(
      explain(db, SYSTEMS_WITHIN_SQL, {
        xmin: -1,
        xmax: 1,
        ymin: -1,
        ymax: 1,
        zmin: -1,
        zmax: 1,
      }),
    ).toContain("idx_systems_x");
    expect(explain(db, RINGS_BY_SYSTEM_SQL, { systemId: 1 })).toContain("idx_bodies_system");
    expect(explain(db, HOTSPOTS_BY_COMMODITY_SQL, { commodityId: "painite" })).toContain(
      "idx_hotspots_commodity",
    );
  });

  it("distance search over 20k systems stays fast (documented benchmark, not a gate)", () => {
    const db2 = openDatabase(":memory:");
    applyMigrations(db2, MIGRATIONS);
    const repo = createSystemRepository(db2);
    const ins = db2.prepare(
      "INSERT INTO systems (name, x, y, z, updated_at) VALUES (@name, @x, @y, @z, 't')",
    );
    const seed = db2.transaction(() => {
      for (let i = 0; i < 20_000; i++) {
        // Spread across a 2000 ly cube deterministically.
        ins.run({
          name: `S${String(i)}`,
          x: (i % 200) - 100,
          y: ((i * 7) % 200) - 100,
          z: ((i * 13) % 200) - 100,
        });
      }
    });
    seed();
    const t0 = performance.now();
    const near = repo.within({ x: 0, y: 0, z: 0 }, 50);
    const ms = performance.now() - t0;
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((s) => s.distanceLy <= 50)).toBe(true);
    console.info(`[galaxy benchmark] within(50 ly) over 20k systems: ${ms.toFixed(1)} ms`);
    db2.close();
  });
});
