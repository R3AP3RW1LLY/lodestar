/**
 * SQLite connection factory (SSOT §3.1). WAL mode for concurrent read while
 * the journal watcher writes; foreign keys enforced. The path is injectable so
 * tests use ':memory:' or a temp file. Native binding (better-sqlite3) is
 * built for the host runtime; the Electron-ABI rebuild happens in the desktop
 * app pipeline (see the desktop package's rebuild scripts).
 */

import Database from "better-sqlite3";

export type Db = Database.Database;

export function openDatabase(path: string): Db {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}
