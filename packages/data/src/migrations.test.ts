import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { MIGRATIONS } from "./migrations/index.js";
import { applyMigrations } from "./migrator.js";

describe("bundled migrations", () => {
  it("form a contiguous set starting at version 1", () => {
    MIGRATIONS.forEach((m, i) => {
      expect(m.version).toBe(i + 1);
    });
  });

  it("apply cleanly to a fresh database (migration 001 creates settings)", () => {
    const db = new Database(":memory:");
    const result = applyMigrations(db, MIGRATIONS);
    expect(result.atVersion).toBe(MIGRATIONS.length);
    // Migration 001 must create the settings table.
    const cols = db.prepare("PRAGMA table_info(settings)").all() as { name: string }[];
    expect(cols.map((c) => c.name).sort()).toEqual(["key", "value"]);
  });

  it("the settings table enforces its invariants (PK uniqueness, NOT NULL value)", () => {
    const db = new Database(":memory:");
    applyMigrations(db, MIGRATIONS);
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("journalPath", '"D:/x"');
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("journalPath") as {
      value: string;
    };
    expect(row.value).toBe('"D:/x"');
    // Duplicate key rejected.
    expect(() =>
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("journalPath", '"y"'),
    ).toThrow();
    // NULL value rejected.
    expect(() =>
      db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("k", null),
    ).toThrow();
  });
});
