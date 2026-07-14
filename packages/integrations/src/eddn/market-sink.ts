/**
 * EDDN → `market_snapshots` sink (SSOT Step 4.8). Writes accepted EDDN markets with
 * `source='eddn'` (upsert on the §5.5 UNIQUE(commodity, market, source) — latest wins),
 * carrying demand + source timestamp. EDDN prices are advisory: the Ledger (4.11) weights
 * first-party sources above `eddn` when they conflict. `prune` bounds retention (the
 * volume-cap half of the ingestion policy). Uses an INJECTED `Db` (type-only import), so
 * the integrations runtime never loads the native driver itself.
 */

import type { Db } from "@lodestar/data";
import type { EddnMarketMessage } from "./commodity-schema.js";
import type { EddnSink } from "./listener.js";

export interface EddnMarketSink extends EddnSink {
  /** Delete EDDN snapshots with a source timestamp older than `cutoffIso`; returns rows removed. */
  prune: (cutoffIso: string) => number;
}

export function createEddnMarketSink(db: Db): EddnMarketSink {
  const upsert = db.prepare(
    `INSERT INTO market_snapshots
       (commodity_id, market_id, sell_price, source, source_ts, station_name, star_system, demand)
     VALUES (@commodityId, @marketId, @sellPrice, 'eddn', @sourceTs, @stationName, @starSystem, @demand)
     ON CONFLICT(commodity_id, market_id, source) DO UPDATE SET
       sell_price = excluded.sell_price, source_ts = excluded.source_ts,
       station_name = excluded.station_name, star_system = excluded.star_system,
       demand = excluded.demand`,
  );
  const pruneStmt = db.prepare(
    "DELETE FROM market_snapshots WHERE source = 'eddn' AND source_ts < ?",
  );
  return {
    record: (market: EddnMarketMessage) => {
      // A per-call param-less transaction closes over `market` (keeps the write atomic
      // without the parameterized-transaction typing that confuses strict linting).
      const write = db.transaction(() => {
        for (const commodity of market.commodities) {
          upsert.run({
            commodityId: commodity.commodityId,
            marketId: market.marketId,
            sellPrice: Math.round(commodity.sellPrice),
            sourceTs: market.timestamp,
            stationName: market.stationName,
            starSystem: market.systemName,
            demand: Math.round(commodity.demand),
          });
        }
      });
      write();
    },
    prune: (cutoffIso) => pruneStmt.run(cutoffIso).changes,
  };
}
