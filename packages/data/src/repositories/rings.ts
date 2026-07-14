/**
 * Rings repository (SSOT Step 4.1) — the ring belts hotspots live in, with ring type
 * + reserve level (the scoring inputs). Upsert keyed on (body_id, name); lookups by
 * body (idx_rings_body) and by system (join bodies via idx_bodies_system).
 */

import type { Db } from "../db.js";

export interface RingInput {
  readonly bodyId: number;
  readonly name: string;
  readonly ringType?: string | null;
  readonly reserve?: string | null;
}

export interface GalaxyRing {
  readonly id: number;
  readonly bodyId: number;
  readonly name: string;
  readonly ringType: string | null;
  readonly reserve: string | null;
  readonly updatedAt: string;
}

interface RingRow {
  readonly id: number;
  readonly body_id: number;
  readonly name: string;
  readonly ring_type: string | null;
  readonly reserve: string | null;
  readonly updated_at: string;
}

/** Rings in a system (join bodies) — exposed so the EXPLAIN test can plan it. */
export const RINGS_BY_SYSTEM_SQL =
  "SELECT r.* FROM rings r JOIN bodies b ON b.id = r.body_id WHERE b.system_id = @systemId ORDER BY r.name";

export interface RingRepository {
  upsert: (input: RingInput, at: string) => number;
  byBody: (bodyId: number) => GalaxyRing[];
  bySystem: (systemId: number) => GalaxyRing[];
}

function toRing(row: RingRow): GalaxyRing {
  return {
    id: row.id,
    bodyId: row.body_id,
    name: row.name,
    ringType: row.ring_type,
    reserve: row.reserve,
    updatedAt: row.updated_at,
  };
}

export function createRingRepository(db: Db): RingRepository {
  const upsertStmt = db.prepare(
    `INSERT INTO rings (body_id, name, ring_type, reserve, updated_at)
       VALUES (@bodyId, @name, @ringType, @reserve, @updatedAt)
     ON CONFLICT(body_id, name) DO UPDATE SET
       ring_type = COALESCE(excluded.ring_type, rings.ring_type),
       reserve = COALESCE(excluded.reserve, rings.reserve), updated_at = excluded.updated_at
     RETURNING id`,
  );
  const byBodyStmt = db.prepare("SELECT * FROM rings WHERE body_id = ? ORDER BY name");
  const bySystemStmt = db.prepare(RINGS_BY_SYSTEM_SQL);
  return {
    upsert: (input, at) =>
      (
        upsertStmt.get({
          bodyId: input.bodyId,
          name: input.name,
          ringType: input.ringType ?? null,
          reserve: input.reserve ?? null,
          updatedAt: at,
        }) as { id: number }
      ).id,
    byBody: (bodyId) => (byBodyStmt.all(bodyId) as RingRow[]).map(toRing),
    bySystem: (systemId) => (bySystemStmt.all({ systemId }) as RingRow[]).map(toRing),
  };
}
