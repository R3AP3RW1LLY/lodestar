/**
 * Overlaps repository (SSOT Step 4.1) — a ring's hotspot overlaps, honestly modelled
 * (Step 4.4): `candidate` (possible — journals give counts not positions) vs
 * `confirmed` (the commander verified it in-game / trusted community source). Only
 * confirmed overlaps feed the scoring multiplier. Commodities are a JSON id array.
 */

import type { Db } from "../db.js";

export type OverlapConfidence = "candidate" | "confirmed";

export interface OverlapInput {
  readonly ringId: number;
  readonly commodities: readonly string[];
  readonly multiplicity?: number;
  readonly confidence?: OverlapConfidence;
  readonly source?: string;
}

export interface Overlap {
  readonly id: number;
  readonly ringId: number;
  readonly commodities: readonly string[];
  readonly multiplicity: number;
  readonly confidence: OverlapConfidence;
  readonly source: string;
  readonly updatedAt: string;
}

interface OverlapRow {
  readonly id: number;
  readonly ring_id: number;
  readonly commodities: string;
  readonly multiplicity: number;
  readonly confidence: OverlapConfidence;
  readonly source: string;
  readonly updated_at: string;
}

export interface OverlapRepository {
  record: (input: OverlapInput, at: string) => number;
  byRing: (ringId: number) => Overlap[];
  /** Promote a candidate to confirmed (the commander saw it in-game). */
  confirm: (id: number, at: string) => void;
}

function toOverlap(row: OverlapRow): Overlap {
  let commodities: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.commodities);
    if (Array.isArray(parsed)) commodities = parsed as string[];
  } catch {
    // A corrupt commodities blob degrades to an empty list — a read never throws.
  }
  return {
    id: row.id,
    ringId: row.ring_id,
    commodities,
    multiplicity: row.multiplicity,
    confidence: row.confidence,
    source: row.source,
    updatedAt: row.updated_at,
  };
}

export function createOverlapRepository(db: Db): OverlapRepository {
  const recordStmt = db.prepare(
    `INSERT INTO overlaps (ring_id, commodities, multiplicity, confidence, source, updated_at)
       VALUES (@ringId, @commodities, @multiplicity, @confidence, @source, @updatedAt)
     RETURNING id`,
  );
  const byRingStmt = db.prepare("SELECT * FROM overlaps WHERE ring_id = ? ORDER BY id");
  const confirmStmt = db.prepare(
    "UPDATE overlaps SET confidence = 'confirmed', updated_at = @at WHERE id = @id",
  );
  return {
    record: (input, at) =>
      (
        recordStmt.get({
          ringId: input.ringId,
          commodities: JSON.stringify(input.commodities),
          multiplicity: input.multiplicity ?? input.commodities.length,
          confidence: input.confidence ?? "candidate",
          source: input.source ?? "journal",
          updatedAt: at,
        }) as { id: number }
      ).id,
    byRing: (ringId) => (byRingStmt.all(ringId) as OverlapRow[]).map(toOverlap),
    confirm: (id, at) => {
      confirmStmt.run({ id, at });
    },
  };
}
