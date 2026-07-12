import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./db.js";

describe("openDatabase", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lodestar-db-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the file, enables WAL and foreign keys", () => {
    const path = join(dir, "lodestar.sqlite3");
    const db = openDatabase(path);
    try {
      expect(existsSync(path)).toBe(true);
      expect((db.pragma("journal_mode", { simple: true }) as string).toLowerCase()).toBe("wal");
      expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      db.close();
    }
  });

  it("opens an in-memory database for tests", () => {
    const db = openDatabase(":memory:");
    try {
      expect(db.open).toBe(true);
    } finally {
      db.close();
    }
  });
});
