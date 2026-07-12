/**
 * DB service: opens the profile SQLite database and brings its schema up to
 * date via the forward-only migration runner. Exposes a status the app.health
 * probe reports, plus the last error so a failure is observable (never a silent
 * degraded state). Opening never throws — a failure yields status 'error'.
 *
 * Contract: callers must check status() === 'ok' before touching .db, which
 * throws if the DB is not open.
 */

import { MIGRATIONS, applyMigrations, openDatabase } from "@lodestar/data";
import type { Db } from "@lodestar/data";

export type DbStatus = "ok" | "error";

export interface DbService {
  readonly db: Db;
  readonly status: () => DbStatus;
  readonly lastError: () => unknown;
  readonly close: () => void;
}

export function createDbService(path: string): DbService {
  let status: DbStatus = "error";
  let lastError: unknown;
  let db: Db | undefined;
  try {
    db = openDatabase(path);
    applyMigrations(db, MIGRATIONS);
    status = "ok";
  } catch (error) {
    status = "error";
    lastError = error;
    if (db !== undefined) {
      try {
        db.close();
      } catch {
        // already failing — nothing more to do
      }
      db = undefined;
    }
  }

  return {
    get db(): Db {
      if (db === undefined) throw new Error("database is not open");
      return db;
    },
    status: () => status,
    lastError: () => lastError,
    close: () => {
      if (db !== undefined) db.close();
    },
  };
}
