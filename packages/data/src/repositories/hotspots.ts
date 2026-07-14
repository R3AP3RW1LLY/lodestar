/**
 * Hotspots repository (SSOT Step 4.1) — a ring's mineable-commodity hotspots with a
 * count + provenance. `record` upserts on (ring_id, commodity_id): a re-scan refreshes
 * count + last_confirmed (and source) but keeps first_seen. `byCommodity` (the Vein
 * Finder hot query) seeks `idx_hotspots_commodity`.
 */

import type { Db } from "../db.js";

export type HotspotSource = "seed" | "journal" | "community";

export interface HotspotInput {
  readonly ringId: number;
  readonly commodityId: string;
  readonly count?: number;
  readonly source?: HotspotSource;
}

export interface Hotspot {
  readonly id: number;
  readonly ringId: number;
  readonly commodityId: string;
  readonly count: number;
  readonly source: HotspotSource;
  readonly firstSeen: string;
  readonly lastConfirmed: string;
}

interface HotspotRow {
  readonly id: number;
  readonly ring_id: number;
  readonly commodity_id: string;
  readonly count: number;
  readonly source: HotspotSource;
  readonly first_seen: string;
  readonly last_confirmed: string;
}

export const HOTSPOTS_BY_COMMODITY_SQL =
  "SELECT * FROM hotspots WHERE commodity_id = @commodityId ORDER BY count DESC";

export interface HotspotRepository {
  /** Insert or refresh a hotspot; returns its id. */
  record: (input: HotspotInput, at: string) => number;
  byRing: (ringId: number) => Hotspot[];
  byCommodity: (commodityId: string) => Hotspot[];
}

function toHotspot(row: HotspotRow): Hotspot {
  return {
    id: row.id,
    ringId: row.ring_id,
    commodityId: row.commodity_id,
    count: row.count,
    source: row.source,
    firstSeen: row.first_seen,
    lastConfirmed: row.last_confirmed,
  };
}

export function createHotspotRepository(db: Db): HotspotRepository {
  const recordStmt = db.prepare(
    `INSERT INTO hotspots (ring_id, commodity_id, count, source, first_seen, last_confirmed)
       VALUES (@ringId, @commodityId, @count, @source, @at, @at)
     ON CONFLICT(ring_id, commodity_id) DO UPDATE SET
       count = excluded.count, source = excluded.source, last_confirmed = excluded.last_confirmed
     RETURNING id`,
  );
  const byRingStmt = db.prepare("SELECT * FROM hotspots WHERE ring_id = ? ORDER BY count DESC");
  const byCommodityStmt = db.prepare(HOTSPOTS_BY_COMMODITY_SQL);
  return {
    record: (input, at) =>
      (
        recordStmt.get({
          ringId: input.ringId,
          commodityId: input.commodityId,
          count: input.count ?? 1,
          source: input.source ?? "journal",
          at,
        }) as { id: number }
      ).id,
    byRing: (ringId) => (byRingStmt.all(ringId) as HotspotRow[]).map(toHotspot),
    byCommodity: (commodityId) =>
      (byCommodityStmt.all({ commodityId }) as HotspotRow[]).map(toHotspot),
  };
}
