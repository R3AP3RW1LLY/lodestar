/**
 * Forward-only migration runner (SSOT §5.5). Migrations are contiguous from
 * version 1, applied in a single transaction each (atomic — a failure rolls
 * back with no partial schema), and recorded in schema_migrations with a
 * checksum. The runner refuses: gaps/duplicates/out-of-order in the migration
 * definitions; a DB whose applied set is not a contiguous 1..n prefix; a DB
 * ahead of the provided set (divergence); and any already-applied migration
 * whose SQL content no longer matches its recorded checksum (silent edits).
 *
 * schema_migrations is infrastructure owned by the runner (created here at
 * bootstrap, before any migration runs — the standard history-table pattern);
 * migration 001 owns the first product table (settings).
 */

import { createHash } from "node:crypto";
import type { Db } from "./db.js";

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface MigrationResult {
  readonly appliedCount: number;
  readonly atVersion: number;
}

interface AppliedRow {
  readonly version: number;
  readonly checksum: string;
}

const SCHEMA_MIGRATIONS_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    checksum   TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
`;

function checksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

function appliedRows(db: Db): AppliedRow[] {
  db.exec(SCHEMA_MIGRATIONS_DDL);
  return db
    .prepare("SELECT version, checksum FROM schema_migrations ORDER BY version")
    .all() as AppliedRow[];
}

export function appliedVersions(db: Db): number[] {
  return appliedRows(db).map((r) => r.version);
}

function assertContiguous(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new Error(
        `Migrations must be contiguous and in order from 1: expected version ${String(expected)} at index ${String(index)}, got ${String(migration.version)}`,
      );
    }
  });
}

export function applyMigrations(db: Db, migrations: readonly Migration[]): MigrationResult {
  assertContiguous(migrations);

  const applied = appliedRows(db);

  // The DB's applied set must itself be a contiguous 1..n prefix — a hole like
  // [1,3] means a migration was skipped and must never be silently tolerated.
  applied.forEach((row, index) => {
    if (row.version !== index + 1) {
      throw new Error(
        `schema_migrations is not a contiguous prefix (found version ${String(row.version)} at position ${String(index)}) — divergence; refusing to run.`,
      );
    }
  });

  const currentVersion = applied.length;

  if (currentVersion > migrations.length) {
    throw new Error(
      `Database schema (version ${String(currentVersion)}) is ahead of the known migrations (${String(migrations.length)}) — divergence; refusing to run.`,
    );
  }

  // Every already-applied migration's content must still match what ran.
  for (const row of applied) {
    const migration = migrations[row.version - 1];
    if (migration === undefined) continue;
    if (checksum(migration.sql) !== row.checksum) {
      throw new Error(
        `Migration ${String(row.version)} (${migration.name}) has been edited since it was applied (checksum mismatch) — refusing to run.`,
      );
    }
  }

  const pending = migrations.filter((m) => m.version > currentVersion);
  const record = db.prepare(
    "INSERT INTO schema_migrations (version, name, checksum) VALUES (?, ?, ?)",
  );

  for (const migration of pending) {
    const runOne = db.transaction(() => {
      db.exec(migration.sql);
      record.run(migration.version, migration.name, checksum(migration.sql));
    });
    runOne();
  }

  return {
    appliedCount: pending.length,
    atVersion: pending.length > 0 ? migrations.length : currentVersion,
  };
}
