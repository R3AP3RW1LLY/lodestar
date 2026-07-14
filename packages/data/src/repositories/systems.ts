/**
 * Systems repository (SSOT Step 4.1) — galaxy reference: name, id64 address, and
 * galactic coordinates. `within` answers the hot spatial query: a cube prefilter on
 * the x axis (idx_systems_x range scan) then an in-TS Euclidean refine to a sphere,
 * so a distance search never full-scans the systems table. Only public reference
 * data + the user's own discoveries.
 */

import type { Db } from "../db.js";

export interface SystemInput {
  readonly address?: number | null;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GalaxySystem {
  readonly id: number;
  readonly address: number | null;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly updatedAt: string;
}

export interface NearbySystem extends GalaxySystem {
  readonly distanceLy: number;
}

/** The cube-prefilter query behind `within` (exposed so EXPLAIN tests can plan it). */
export const SYSTEMS_WITHIN_SQL =
  "SELECT * FROM systems WHERE x BETWEEN @xmin AND @xmax AND y BETWEEN @ymin AND @ymax AND z BETWEEN @zmin AND @zmax";

interface SystemRow {
  readonly id: number;
  readonly address: number | null;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly updated_at: string;
}

export interface SystemRepository {
  /** Insert or update by name; returns the row id. */
  upsert: (input: SystemInput, at: string) => number;
  byId: (id: number) => GalaxySystem | undefined;
  byName: (name: string) => GalaxySystem | undefined;
  /** Systems within `radiusLy` of a point, nearest first (with distance). */
  within: (center: { x: number; y: number; z: number }, radiusLy: number) => NearbySystem[];
}

function toSystem(row: SystemRow): GalaxySystem {
  return {
    id: row.id,
    address: row.address,
    name: row.name,
    x: row.x,
    y: row.y,
    z: row.z,
    updatedAt: row.updated_at,
  };
}

export function createSystemRepository(db: Db): SystemRepository {
  const upsertStmt = db.prepare(
    `INSERT INTO systems (address, name, x, y, z, updated_at)
       VALUES (@address, @name, @x, @y, @z, @updatedAt)
     ON CONFLICT(name) DO UPDATE SET
       address = COALESCE(excluded.address, systems.address),
       x = excluded.x, y = excluded.y, z = excluded.z, updated_at = excluded.updated_at
     RETURNING id`,
  );
  const byIdStmt = db.prepare("SELECT * FROM systems WHERE id = ?");
  const byNameStmt = db.prepare("SELECT * FROM systems WHERE name = ?");
  const withinStmt = db.prepare(SYSTEMS_WITHIN_SQL);

  return {
    upsert: (input, at) =>
      (
        upsertStmt.get({
          address: input.address ?? null,
          name: input.name,
          x: input.x,
          y: input.y,
          z: input.z,
          updatedAt: at,
        }) as { id: number }
      ).id,
    byId: (id) => {
      const row = byIdStmt.get(id) as SystemRow | undefined;
      return row === undefined ? undefined : toSystem(row);
    },
    byName: (name) => {
      const row = byNameStmt.get(name) as SystemRow | undefined;
      return row === undefined ? undefined : toSystem(row);
    },
    within: (center, radiusLy) => {
      const rows = withinStmt.all({
        xmin: center.x - radiusLy,
        xmax: center.x + radiusLy,
        ymin: center.y - radiusLy,
        ymax: center.y + radiusLy,
        zmin: center.z - radiusLy,
        zmax: center.z + radiusLy,
      }) as SystemRow[];
      return rows
        .map((row) => {
          const dx = row.x - center.x;
          const dy = row.y - center.y;
          const dz = row.z - center.z;
          return { ...toSystem(row), distanceLy: Math.sqrt(dx * dx + dy * dy + dz * dz) };
        })
        .filter((s) => s.distanceLy <= radiusLy)
        .sort((a, b) => a.distanceLy - b.distanceLy);
    },
  };
}
