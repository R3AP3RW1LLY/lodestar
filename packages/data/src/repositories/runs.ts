/**
 * Runs repository (SSOT Step 4.1) — planned mining trips: the full plan JSON +
 * estimated tons/hr & cr/hr at creation, actuals + status filled on completion (so
 * Phase-6 calibration can learn estimate-vs-actual). The plan blob is opaque here.
 */

import type { Db } from "../db.js";

export type RunStatus = "planned" | "active" | "completed" | "abandoned";

export interface RunInput {
  readonly plan: string;
  readonly estimatedTph?: number | null;
  readonly estimatedCph?: number | null;
}

export interface Run {
  readonly id: number;
  readonly createdAt: string;
  readonly plan: string;
  readonly estimatedTph: number | null;
  readonly estimatedCph: number | null;
  readonly actualTph: number | null;
  readonly actualCph: number | null;
  readonly status: RunStatus;
  readonly completedAt: string | null;
}

interface RunRow {
  readonly id: number;
  readonly created_at: string;
  readonly plan: string;
  readonly estimated_tph: number | null;
  readonly estimated_cph: number | null;
  readonly actual_tph: number | null;
  readonly actual_cph: number | null;
  readonly status: RunStatus;
  readonly completed_at: string | null;
}

export interface RunRepository {
  create: (input: RunInput, at: string) => number;
  /** Record actuals + mark completed. */
  complete: (id: number, actuals: { tph: number; cph: number }, at: string) => void;
  byId: (id: number) => Run | undefined;
  listRecent: (limit?: number) => Run[];
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    createdAt: row.created_at,
    plan: row.plan,
    estimatedTph: row.estimated_tph,
    estimatedCph: row.estimated_cph,
    actualTph: row.actual_tph,
    actualCph: row.actual_cph,
    status: row.status,
    completedAt: row.completed_at,
  };
}

export function createRunRepository(db: Db): RunRepository {
  const createStmt = db.prepare(
    `INSERT INTO runs (created_at, plan, estimated_tph, estimated_cph, status)
       VALUES (@at, @plan, @estimatedTph, @estimatedCph, 'planned')
     RETURNING id`,
  );
  const completeStmt = db.prepare(
    `UPDATE runs SET actual_tph = @tph, actual_cph = @cph, status = 'completed', completed_at = @at
     WHERE id = @id`,
  );
  const byIdStmt = db.prepare("SELECT * FROM runs WHERE id = ?");
  const recentStmt = db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?");
  return {
    create: (input, at) =>
      (
        createStmt.get({
          at,
          plan: input.plan,
          estimatedTph: input.estimatedTph ?? null,
          estimatedCph: input.estimatedCph ?? null,
        }) as { id: number }
      ).id,
    complete: (id, actuals, at) => {
      completeStmt.run({ id, tph: actuals.tph, cph: actuals.cph, at });
    },
    byId: (id) => {
      const row = byIdStmt.get(id) as RunRow | undefined;
      return row === undefined ? undefined : toRun(row);
    },
    listRecent: (limit = 50) => (recentStmt.all(limit) as RunRow[]).map(toRun),
  };
}
