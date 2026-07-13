import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import type { MarketSellEvent, MarketSnapshot } from "@lodestar/shared";
import { assay, mergeThresholds } from "@lodestar/intelligence";
import { parseMarket } from "../livefiles/market.js";
import { createPriceBookStore } from "./price-book.js";

/** A Market.json fixture — items use "$..._name;" symbols (the naming scheme 2.2 joins). */
function marketFixture(marketId: number, painiteSell: number, extra = ""): MarketSnapshot {
  const raw = `{"timestamp":"2025-06-01T12:00:00Z","event":"Market","MarketID":${String(marketId)},"StationName":"Demo Station","StarSystem":"Sys","Items":[{"id":1,"Name":"$painite_name;","Name_Localised":"Painite","Category":"$MARKET_category_minerals;","BuyPrice":0,"SellPrice":${String(painiteSell)},"MeanPrice":400000,"Demand":100,"Stock":0}${extra}]}`;
  const r = parseMarket(raw);
  if (!r.ok) throw new Error(`bad market fixture: ${JSON.stringify(r.error)}`);
  return r.value;
}

const sale = (over: Partial<MarketSellEvent>): MarketSellEvent => ({
  event: "MarketSell",
  timestamp: "2025-06-01T12:30:00Z",
  marketId: 999,
  type: "painite",
  count: 5,
  sellPrice: 480_000,
  totalSale: 2_400_000,
  avgPricePaid: 0,
  ...over,
});

describe("price book v1 (migration 004)", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
  });
  afterEach(() => {
    db.close();
  });

  it("migration 004 created the market_snapshots table", () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain("market_snapshots");
  });

  it("ingests a Market.json snapshot and exposes the best price (canonical id, aged)", () => {
    const store = createPriceBookStore(db);
    expect(store.ingestMarket(marketFixture(100, 500_000))).toBe(1);
    const best = store.best("painite");
    expect(best?.sellPrice).toBe(500_000);
    expect(best?.source).toBe("market");
    expect(best?.sourceTs).toBe("2025-06-01T12:00:00Z"); // age stamped
    expect(best?.stationName).toBe("Demo Station");
  });

  it("best() returns the highest sell price across markets", () => {
    const store = createPriceBookStore(db);
    store.ingestMarket(marketFixture(100, 500_000));
    store.ingestMarket(marketFixture(200, 620_000)); // a better market
    expect(store.best("painite")?.sellPrice).toBe(620_000);
    expect(store.best("painite")?.marketId).toBe(200);
  });

  it("re-docking the same market updates (upserts) its price", () => {
    const store = createPriceBookStore(db);
    store.ingestMarket(marketFixture(100, 500_000));
    store.ingestMarket(marketFixture(100, 450_000)); // price dropped at the same market
    const rows = db.prepare("SELECT COUNT(*) AS n FROM market_snapshots").get() as { n: number };
    expect(rows.n).toBe(1); // upserted, not duplicated
    expect(store.best("painite")?.sellPrice).toBe(450_000);
  });

  it("skips zero-sell items (station doesn't buy) and unknown commodities", () => {
    const store = createPriceBookStore(db);
    // painite sellPrice 0 + an unknown "$adamantium_name;" item.
    const snapshot = marketFixture(
      100,
      0,
      `,{"id":2,"Name":"$adamantium_name;","Name_Localised":"Adamantium","Category":"x","BuyPrice":0,"SellPrice":700000,"MeanPrice":0,"Demand":0,"Stock":0}`,
    );
    expect(store.ingestMarket(snapshot)).toBe(0);
    expect(store.best("painite")).toBeUndefined();
  });

  it("ingests a MarketSell price (lowercase internal name → canonical)", () => {
    const store = createPriceBookStore(db);
    expect(store.ingestSale(sale({ sellPrice: 480_000 }))).toBe(true);
    expect(store.best("painite")?.sellPrice).toBe(480_000);
    expect(store.best("painite")?.source).toBe("marketsell");
    // an unknown commodity or zero price is not stored
    expect(store.ingestSale(sale({ type: "adamantium" }))).toBe(false);
    expect(store.ingestSale(sale({ sellPrice: 0 }))).toBe(false);
  });

  it("cross-source: a Market.json fixture joins a prospect fixture, and the verdict value/t reflects it", () => {
    const store = createPriceBookStore(db);
    const resolve = store.resolver();
    const th = mergeThresholds();
    // A painite prospect (ProspectedAsteroid uses "Painite"); the market uses the
    // "$painite_name;" symbol — both canonicalize to "painite" and join.
    const prospect = {
      materials: [{ name: "Painite", proportion: 30 }],
      content: "$AsteroidMaterialContent_High;",
      remainingPct: 100,
    };

    // Before any market data: no price → value/t 0.
    expect(assay(prospect, "laser", th, resolve).score).toBe(0);

    // After docking: the verdict's value/t reflects the ingested price.
    store.ingestMarket(marketFixture(100, 500_000));
    expect(assay(prospect, "laser", th, resolve).score).toBeCloseTo(150_000, 5); // 500k × 0.30
  });
});
