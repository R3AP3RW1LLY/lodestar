import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS, openDatabase } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createLedgerService } from "./ledger-service.js";

const NOW = Date.parse("2025-06-01T12:00:00Z");

/** Seed market_snapshots: two painite markets (a fresh journal + a stale-but-higher eddn) + one platinum. */
function seed(db: Db): void {
  const ins = db.prepare(
    `INSERT INTO market_snapshots
       (commodity_id, market_id, sell_price, source, source_ts, station_name, star_system, pad_size, demand)
     VALUES (@c, @m, @p, @src, @ts, @st, @sys, @pad, @dem)`,
  );
  ins.run({
    c: "painite",
    m: 1,
    p: 500_000,
    src: "journal",
    ts: "2025-06-01T12:00:00Z",
    st: "Fresh",
    sys: "Paesia",
    pad: "L",
    dem: 900,
  });
  ins.run({
    c: "painite",
    m: 2,
    p: 550_000,
    src: "eddn",
    ts: "2025-05-30T12:00:00Z",
    st: "StaleHigh",
    sys: "Borann",
    pad: "M",
    dem: 400,
  });
  ins.run({
    c: "platinum",
    m: 3,
    p: 200_000,
    src: "capi",
    ts: "2025-06-01T11:00:00Z",
    st: "PlatPort",
    sys: "Delkar",
    pad: "L",
    dem: 700,
  });
}

describe("ledger service", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    seed(db);
  });
  afterEach(() => db.close());

  it("ranks best sell stations for a commodity (fresh first-party beats stale EDDN)", () => {
    const svc = createLedgerService(db, () => NOW);
    const ranked = svc.bestStations("painite");
    expect(ranked.map((r) => r.stationName)).toEqual(["Fresh", "StaleHigh"]);
    expect(ranked[0]).toMatchObject({ source: "journal", sellPrice: 500_000 });
  });

  it("applies a pad-size filter", () => {
    const svc = createLedgerService(db, () => NOW);
    const ranked = svc.bestStations("painite", { minPad: "L" });
    expect(ranked.map((r) => r.stationName)).toEqual(["Fresh"]); // StaleHigh is pad M
  });

  it("builds a per-commodity board with the best station each", () => {
    const board = createLedgerService(db, () => NOW).board();
    expect(board.map((b) => b.commodityId)).toEqual(["painite", "platinum"]);
    expect(board.find((b) => b.commodityId === "painite")?.best?.stationName).toBe("Fresh");
    expect(board.find((b) => b.commodityId === "platinum")?.best?.stationName).toBe("PlatPort");
  });

  it("produces a price trend series for a commodity", () => {
    const trend = createLedgerService(db, () => NOW).trend("painite", 24 * 60 * 60 * 1000);
    expect(trend.length).toBeGreaterThan(0);
    expect(trend.every((p) => p.maxSellPrice >= p.avgSellPrice)).toBe(true);
  });
});
