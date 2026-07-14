import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS, openDatabase } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createEddnMarketSink } from "./market-sink.js";
import type { EddnMarketMessage } from "./commodity-schema.js";

const market = (over: Partial<EddnMarketMessage> = {}): EddnMarketMessage => ({
  systemName: "Paesia",
  stationName: "Nemere Terminal",
  marketId: 128016640,
  timestamp: "2025-06-01T12:00:00Z",
  commodities: [
    { commodityId: "painite", sellPrice: 512340.7, demand: 1200 },
    { commodityId: "platinum", sellPrice: 190500, demand: 4500 },
  ],
  ...over,
});

describe("createEddnMarketSink", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
  });
  afterEach(() => db.close());

  const rows = () =>
    db
      .prepare(
        "SELECT commodity_id, sell_price, source, source_ts, star_system, demand FROM market_snapshots ORDER BY commodity_id",
      )
      .all() as {
      commodity_id: string;
      sell_price: number;
      source: string;
      source_ts: string;
      star_system: string;
      demand: number;
    }[];

  it("writes each commodity as a source='eddn' snapshot (price rounded, demand kept)", () => {
    createEddnMarketSink(db).record(market());
    expect(rows()).toEqual([
      {
        commodity_id: "painite",
        sell_price: 512341, // rounded
        source: "eddn",
        source_ts: "2025-06-01T12:00:00Z",
        star_system: "Paesia",
        demand: 1200,
      },
      {
        commodity_id: "platinum",
        sell_price: 190500,
        source: "eddn",
        source_ts: "2025-06-01T12:00:00Z",
        star_system: "Paesia",
        demand: 4500,
      },
    ]);
  });

  it("upserts on (commodity, market, source): a newer snapshot replaces, not duplicates", () => {
    const sink = createEddnMarketSink(db);
    sink.record(market());
    sink.record(
      market({
        timestamp: "2025-06-02T12:00:00Z",
        commodities: [{ commodityId: "painite", sellPrice: 600000, demand: 900 }],
      }),
    );
    const painite = rows().find((r) => r.commodity_id === "painite");
    expect(painite).toMatchObject({ sell_price: 600000, source_ts: "2025-06-02T12:00:00Z" });
    expect(rows()).toHaveLength(2); // painite updated in place + the original platinum
  });

  it("prune() bounds retention, deleting EDDN snapshots older than the cutoff", () => {
    const sink = createEddnMarketSink(db);
    sink.record(market({ timestamp: "2025-01-01T00:00:00Z" }));
    sink.record(
      market({
        marketId: 999,
        timestamp: "2025-06-01T00:00:00Z",
        commodities: [{ commodityId: "painite", sellPrice: 500000, demand: 100 }],
      }),
    );
    const removed = sink.prune("2025-03-01T00:00:00Z");
    expect(removed).toBe(2); // the two January rows
    expect(rows().every((r) => r.source_ts >= "2025-03-01T00:00:00Z")).toBe(true);
  });
});
