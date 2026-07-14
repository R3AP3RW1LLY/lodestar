/**
 * Stations repository (SSOT Step 4.1) — where ore sells: pad size + distance-to-arrival
 * feed the sell-leg penalty in scoring. Upsert keyed on (system_id, name); lookups
 * seek `idx_stations_system`.
 */

import type { Db } from "../db.js";

export interface StationInput {
  readonly systemId: number;
  readonly name: string;
  readonly marketId?: number | null;
  readonly padSize?: string | null;
  readonly stationType?: string | null;
  readonly distanceLs?: number | null;
}

export interface GalaxyStation {
  readonly id: number;
  readonly systemId: number;
  readonly marketId: number | null;
  readonly name: string;
  readonly padSize: string | null;
  readonly stationType: string | null;
  readonly distanceLs: number | null;
  readonly updatedAt: string;
}

interface StationRow {
  readonly id: number;
  readonly system_id: number;
  readonly market_id: number | null;
  readonly name: string;
  readonly pad_size: string | null;
  readonly station_type: string | null;
  readonly distance_ls: number | null;
  readonly updated_at: string;
}

export interface StationRepository {
  upsert: (input: StationInput, at: string) => number;
  bySystem: (systemId: number) => GalaxyStation[];
}

function toStation(row: StationRow): GalaxyStation {
  return {
    id: row.id,
    systemId: row.system_id,
    marketId: row.market_id,
    name: row.name,
    padSize: row.pad_size,
    stationType: row.station_type,
    distanceLs: row.distance_ls,
    updatedAt: row.updated_at,
  };
}

export function createStationRepository(db: Db): StationRepository {
  const upsertStmt = db.prepare(
    `INSERT INTO stations (system_id, name, market_id, pad_size, station_type, distance_ls, updated_at)
       VALUES (@systemId, @name, @marketId, @padSize, @stationType, @distanceLs, @updatedAt)
     ON CONFLICT(system_id, name) DO UPDATE SET
       market_id = COALESCE(excluded.market_id, stations.market_id),
       pad_size = COALESCE(excluded.pad_size, stations.pad_size),
       station_type = COALESCE(excluded.station_type, stations.station_type),
       distance_ls = COALESCE(excluded.distance_ls, stations.distance_ls),
       updated_at = excluded.updated_at
     RETURNING id`,
  );
  const bySystemStmt = db.prepare("SELECT * FROM stations WHERE system_id = ? ORDER BY name");
  return {
    upsert: (input, at) =>
      (
        upsertStmt.get({
          systemId: input.systemId,
          name: input.name,
          marketId: input.marketId ?? null,
          padSize: input.padSize ?? null,
          stationType: input.stationType ?? null,
          distanceLs: input.distanceLs ?? null,
          updatedAt: at,
        }) as { id: number }
      ).id,
    bySystem: (systemId) => (bySystemStmt.all(systemId) as StationRow[]).map(toStation),
  };
}
