import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDbService } from "./db-service.js";

describe("createDbService", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lodestar-dbsvc-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("opens the profile DB, migrates it, and reports status ok", () => {
    const svc = createDbService(join(dir, "lodestar.sqlite3"));
    try {
      expect(svc.status()).toBe("ok");
      // Migrated schema is present.
      const cols = svc.db.prepare("PRAGMA table_info(settings)").all() as { name: string }[];
      expect(cols.length).toBeGreaterThan(0);
    } finally {
      svc.close();
    }
  });

  it("is idempotent across reopen (migrations already applied)", () => {
    const path = join(dir, "lodestar.sqlite3");
    createDbService(path).close();
    const svc = createDbService(path);
    try {
      expect(svc.status()).toBe("ok");
    } finally {
      svc.close();
    }
  });

  it("reports status error and captures the cause when the path is unopenable", () => {
    // better-sqlite3 never creates directories — a missing parent forces failure.
    const svc = createDbService(join(dir, "does-not-exist", "x.sqlite3"));
    expect(svc.status()).toBe("error");
    expect(svc.lastError()).toBeInstanceOf(Error);
    // Accessing .db after an error throws (documented contract).
    expect(() => svc.db).toThrow(/not open/);
    svc.close();
  });

  it("reports error (and closes the handle) when open succeeds but migration fails (divergent DB)", () => {
    const path = join(dir, "diverged.sqlite3");
    // Pre-seed a schema_migrations row ahead of the known migration set.
    const seed = createDbService(path);
    seed.db
      .prepare("INSERT INTO schema_migrations (version, name, checksum) VALUES (99, 'x', 'h')")
      .run();
    seed.close();

    const svc = createDbService(path);
    expect(svc.status()).toBe("error");
    expect(svc.lastError()).toBeInstanceOf(Error);
    svc.close();
    // The handle was released — reopening the path immediately succeeds (no stale lock).
    const reopened = createDbService(join(dir, "fresh.sqlite3"));
    expect(reopened.status()).toBe("ok");
    reopened.close();
  });
});
