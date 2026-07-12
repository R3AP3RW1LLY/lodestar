import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations, appliedVersions } from "./migrator.js";
import type { Migration } from "./migrator.js";

function memDb(): Database.Database {
  return new Database(":memory:");
}

const M1: Migration = {
  version: 1,
  name: "init",
  sql: "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
};
const M2: Migration = {
  version: 2,
  name: "add-widget",
  sql: "CREATE TABLE widget (id INTEGER PRIMARY KEY);",
};

describe("applyMigrations", () => {
  it("applies migrations in order and records them in schema_migrations", () => {
    const db = memDb();
    const result = applyMigrations(db, [M1, M2]);
    expect(result).toEqual({ appliedCount: 2, atVersion: 2 });
    expect(appliedVersions(db)).toEqual([1, 2]);
    // The tables really exist.
    expect(() => db.prepare("SELECT * FROM settings").all()).not.toThrow();
    expect(() => db.prepare("SELECT * FROM widget").all()).not.toThrow();
  });

  it("is idempotent — re-running applies nothing", () => {
    const db = memDb();
    applyMigrations(db, [M1, M2]);
    const second = applyMigrations(db, [M1, M2]);
    expect(second).toEqual({ appliedCount: 0, atVersion: 2 });
    expect(appliedVersions(db)).toEqual([1, 2]);
  });

  it("applies only the new migrations when the set grows", () => {
    const db = memDb();
    applyMigrations(db, [M1]);
    const result = applyMigrations(db, [M1, M2]);
    expect(result).toEqual({ appliedCount: 1, atVersion: 2 });
  });

  it("rejects a gap in version numbers (must be contiguous from 1)", () => {
    const db = memDb();
    expect(() => applyMigrations(db, [M1, { ...M2, version: 3 }])).toThrow(/contiguous|gap/i);
  });

  it("rejects out-of-order / duplicate versions", () => {
    const db = memDb();
    expect(() => applyMigrations(db, [M2, M1])).toThrow(/order|contiguous/i);
    expect(() => applyMigrations(db, [M1, { ...M2, version: 1 }])).toThrow(
      /duplicate|order|contiguous/i,
    );
  });

  it("refuses to run if the DB is ahead of the provided migration set (divergence)", () => {
    const db = memDb();
    applyMigrations(db, [M1, M2]);
    expect(() => applyMigrations(db, [M1])).toThrow(/diverg|ahead/i);
  });

  it("refuses a non-contiguous applied set (a skipped migration, e.g. [1,3])", () => {
    const db = memDb();
    applyMigrations(db, [M1]);
    // Simulate a corrupt history: version 3 recorded without 2.
    db.prepare(
      "INSERT INTO schema_migrations (version, name, checksum) VALUES (3, 'x', 'h')",
    ).run();
    expect(() => applyMigrations(db, [M1, M2, { ...M2, version: 3 }])).toThrow(
      /contiguous prefix|diverg/i,
    );
  });

  it("refuses to run if an already-applied migration's content was edited (checksum mismatch)", () => {
    const db = memDb();
    applyMigrations(db, [M1]);
    const editedM1: Migration = { ...M1, sql: `${M1.sql} -- sneaky edit` };
    expect(() => applyMigrations(db, [editedM1])).toThrow(/edited|checksum/i);
  });

  it("rolls back a failing migration atomically (no partial apply, version unchanged)", () => {
    const db = memDb();
    applyMigrations(db, [M1]);
    const bad: Migration = { version: 2, name: "bad", sql: "CREATE TABLE ok(x); THIS IS NOT SQL;" };
    expect(() => applyMigrations(db, [M1, bad])).toThrow();
    expect(appliedVersions(db)).toEqual([1]);
    // The partial table from the failed migration must not survive.
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ok'")
      .all();
    expect(tables).toEqual([]);
  });
});
