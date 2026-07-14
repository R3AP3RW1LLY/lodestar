/**
 * Ledger service (SSOT Step 4.11). Feeds the pure `intelligence/ledger` ranking + trend
 * functions from `market_snapshots`: reads the per-commodity snapshots (all sources), maps
 * them to `SellSnapshot`s, and ranks / trends them. First-party vs EDDN weighting + the
 * freshness decay live in `intelligence`; this service is the DB → intelligence adapter.
 */

import type { Db } from "@lodestar/data";
import type {
  LedgerTrendPoint,
  RankedStation,
  SellFilter,
  SellSnapshot,
} from "@lodestar/intelligence";
import { priceTrend, rankSellStations } from "@lodestar/intelligence";

interface MarketRow {
  readonly commodity_id: string;
  readonly market_id: number;
  readonly sell_price: number;
  readonly source: string;
  readonly source_ts: string;
  readonly station_name: string | null;
  readonly star_system: string | null;
  readonly pad_size: string | null;
  readonly demand: number | null;
}

function toSnapshot(row: MarketRow): SellSnapshot {
  return {
    commodityId: row.commodity_id,
    marketId: row.market_id,
    stationName: row.station_name ?? "Unknown Station",
    systemName: row.star_system ?? "Unknown System",
    sellPrice: row.sell_price,
    source: row.source,
    sourceTsMs: Date.parse(row.source_ts),
    ...(row.pad_size === null ? {} : { padSize: row.pad_size }),
    ...(row.demand === null ? {} : { demand: row.demand }),
  };
}

export interface CommodityBoardEntry {
  readonly commodityId: string;
  readonly best: RankedStation | undefined;
}

export interface LedgerService {
  /** Best sell stations for a commodity (ranked). */
  bestStations: (commodityId: string, filter?: SellFilter) => RankedStation[];
  /** Time-bucketed price trend for a commodity. */
  trend: (commodityId: string, bucketMs: number) => LedgerTrendPoint[];
  /** Best station per commodity, for the commodity board. */
  board: () => CommodityBoardEntry[];
}

export function createLedgerService(db: Db, now: () => number): LedgerService {
  const byCommodity = db.prepare("SELECT * FROM market_snapshots WHERE commodity_id = ?");
  const distinctCommodities = db.prepare(
    "SELECT DISTINCT commodity_id FROM market_snapshots ORDER BY commodity_id",
  );

  const snapshotsFor = (commodityId: string): SellSnapshot[] =>
    (byCommodity.all(commodityId) as MarketRow[]).map(toSnapshot);

  return {
    bestStations: (commodityId, filter) =>
      rankSellStations(snapshotsFor(commodityId), now(), filter),
    trend: (commodityId, bucketMs) => priceTrend(snapshotsFor(commodityId), bucketMs),
    board: () =>
      (distinctCommodities.all() as { commodity_id: string }[]).map((r) => {
        const ranked = rankSellStations(snapshotsFor(r.commodity_id), now());
        return { commodityId: r.commodity_id, best: ranked[0] };
      }),
  };
}
