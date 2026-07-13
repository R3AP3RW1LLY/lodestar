/**
 * Price book v1 (SSOT Step 2.5). Ingests `Market.json` snapshots (on dock) and
 * `MarketSell` events into per-market commodity sell prices keyed by CANONICAL id
 * (Step 2.2), stamped with source + source-time. Exposes the best-known sell
 * price per commodity (the best market to sell at) — this is the price book the
 * Assay verdict engine (2.4) consumes for value/t. Galaxy-wide sources (EDDN/
 * Inara/cAPI) widen this in Phase 4 through the SAME table + interface. Only the
 * user's own local data.
 */

import type { Db } from "@lodestar/data";
import type { MarketSellEvent, MarketSnapshot } from "@lodestar/shared";
import { commodityFromInternal } from "@lodestar/shared";

export type PriceSource = "market" | "marketsell";

export interface BestPrice {
  readonly commodityId: string;
  readonly sellPrice: number;
  readonly source: PriceSource;
  /** The observation's own timestamp — surfaced as data-age in the UI. */
  readonly sourceTs: string;
  readonly marketId: number;
  readonly stationName: string | undefined;
}

/** The resolver shape the verdict engine's `priceBook` parameter expects (2.4). */
export type PriceResolver = (commodityId: string) => number | undefined;

export interface PriceBookStore {
  /** Ingest a Market.json snapshot; returns the number of priced commodities stored. */
  ingestMarket: (snapshot: MarketSnapshot) => number;
  /** Ingest a MarketSell; returns whether it resolved to a known commodity + stored. */
  ingestSale: (sale: MarketSellEvent) => boolean;
  /** Best-known sell price (across markets) for a commodity, or undefined. */
  best: (commodityId: string) => BestPrice | undefined;
  /** A `(commodityId) → sellPrice | undefined` resolver for the verdict engine. */
  resolver: () => PriceResolver;
}

interface BestRow {
  readonly commodity_id: string;
  readonly market_id: number;
  readonly sell_price: number;
  readonly source: string;
  readonly source_ts: string;
  readonly station_name: string | null;
}

export function createPriceBookStore(db: Db): PriceBookStore {
  const upsert = db.prepare(
    `INSERT INTO market_snapshots
       (commodity_id, market_id, sell_price, source, source_ts, station_name, star_system)
     VALUES (@commodityId, @marketId, @sellPrice, @source, @sourceTs, @stationName, @starSystem)
     ON CONFLICT (commodity_id, market_id, source) DO UPDATE SET
       sell_price = excluded.sell_price, source_ts = excluded.source_ts,
       station_name = excluded.station_name, star_system = excluded.star_system`,
  );
  const bestStmt = db.prepare(
    `SELECT commodity_id, market_id, sell_price, source, source_ts, station_name
       FROM market_snapshots WHERE commodity_id = ?
       ORDER BY sell_price DESC, source_ts DESC LIMIT 1`,
  );

  const ingestMarket = db.transaction((snapshot: MarketSnapshot): number => {
    let stored = 0;
    for (const item of snapshot.items) {
      // A station that doesn't buy a commodity lists sellPrice 0 — not a price.
      if (item.sellPrice <= 0) continue;
      const r = commodityFromInternal(item.name);
      if (!r.ok) continue;
      upsert.run({
        commodityId: r.commodity.id,
        marketId: snapshot.marketId,
        sellPrice: item.sellPrice,
        source: "market",
        sourceTs: snapshot.timestamp,
        stationName: snapshot.stationName,
        starSystem: snapshot.starSystem,
      });
      stored += 1;
    }
    return stored;
  });

  return {
    ingestMarket: (snapshot) => ingestMarket(snapshot),
    ingestSale: (sale) => {
      if (sale.sellPrice <= 0) return false;
      const r = commodityFromInternal(sale.type);
      if (!r.ok) return false;
      upsert.run({
        commodityId: r.commodity.id,
        marketId: sale.marketId,
        sellPrice: sale.sellPrice,
        source: "marketsell",
        sourceTs: sale.timestamp,
        stationName: null,
        starSystem: null,
      });
      return true;
    },
    best: (commodityId) => {
      const row = bestStmt.get(commodityId) as BestRow | undefined;
      if (row === undefined) return undefined;
      return {
        commodityId: row.commodity_id,
        sellPrice: row.sell_price,
        source: row.source === "marketsell" ? "marketsell" : "market",
        sourceTs: row.source_ts,
        marketId: row.market_id,
        stationName: row.station_name ?? undefined,
      };
    },
    resolver() {
      return (commodityId) => {
        const row = bestStmt.get(commodityId) as BestRow | undefined;
        return row?.sell_price;
      };
    },
  };
}
