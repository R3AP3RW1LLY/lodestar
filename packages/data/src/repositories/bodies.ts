/**
 * Bodies repository (SSOT Step 4.1) — planets/stars within a system, the parent of
 * rings. Upsert is keyed on (system_id, name); lookups seek `idx_bodies_system`.
 */

import type { Db } from "../db.js";

export interface BodyInput {
  readonly systemId: number;
  readonly name: string;
  readonly bodyType?: string | null;
}

export interface GalaxyBody {
  readonly id: number;
  readonly systemId: number;
  readonly name: string;
  readonly bodyType: string | null;
  readonly updatedAt: string;
}

interface BodyRow {
  readonly id: number;
  readonly system_id: number;
  readonly name: string;
  readonly body_type: string | null;
  readonly updated_at: string;
}

export interface BodyRepository {
  upsert: (input: BodyInput, at: string) => number;
  bySystem: (systemId: number) => GalaxyBody[];
}

function toBody(row: BodyRow): GalaxyBody {
  return {
    id: row.id,
    systemId: row.system_id,
    name: row.name,
    bodyType: row.body_type,
    updatedAt: row.updated_at,
  };
}

export function createBodyRepository(db: Db): BodyRepository {
  const upsertStmt = db.prepare(
    `INSERT INTO bodies (system_id, name, body_type, updated_at)
       VALUES (@systemId, @name, @bodyType, @updatedAt)
     ON CONFLICT(system_id, name) DO UPDATE SET
       body_type = COALESCE(excluded.body_type, bodies.body_type), updated_at = excluded.updated_at
     RETURNING id`,
  );
  const bySystemStmt = db.prepare("SELECT * FROM bodies WHERE system_id = ? ORDER BY name");
  return {
    upsert: (input, at) =>
      (
        upsertStmt.get({
          systemId: input.systemId,
          name: input.name,
          bodyType: input.bodyType ?? null,
          updatedAt: at,
        }) as { id: number }
      ).id,
    bySystem: (systemId) => (bySystemStmt.all(systemId) as BodyRow[]).map(toBody),
  };
}
