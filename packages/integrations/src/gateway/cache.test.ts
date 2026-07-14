import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import {
  cacheKey,
  conditionalHeaders,
  createMemoryCacheStore,
  createSqliteCacheStore,
  lookupCache,
} from "./cache.js";
import type { CacheStore, CachedResponse } from "./cache.js";

const entry = (over: Partial<CachedResponse> = {}): CachedResponse => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: '{"x":1}',
  storedAtMs: 1000,
  ttlMs: 10_000,
  ...over,
});

describe("cacheKey", () => {
  it("combines an uppercased method with the URL", () => {
    expect(cacheKey("get", "https://www.edsm.net/x")).toBe("GET https://www.edsm.net/x");
  });
});

describe("lookupCache", () => {
  const store = createMemoryCacheStore();
  store.set("k", entry({ storedAtMs: 1000, ttlMs: 10_000 }));

  it("reports a miss for an absent key", () => {
    expect(lookupCache(store, "absent", 5000)).toEqual({ state: "miss" });
  });
  it("reports fresh within the TTL, with age", () => {
    const r = lookupCache(store, "k", 6000);
    expect(r.state).toBe("fresh");
    if (r.state !== "miss") expect(r.ageMs).toBe(5000);
  });
  it("reports stale past the TTL", () => {
    expect(lookupCache(store, "k", 20_000).state).toBe("stale");
  });
});

describe("conditionalHeaders", () => {
  it("emits If-None-Match / If-Modified-Since from the stored validators", () => {
    expect(
      conditionalHeaders(entry({ etag: 'W/"abc"', lastModified: "Sun, 01 Jun 2025 GMT" })),
    ).toEqual({ "If-None-Match": 'W/"abc"', "If-Modified-Since": "Sun, 01 Jun 2025 GMT" });
  });
  it("is empty when the entry carries no validators", () => {
    expect(conditionalHeaders(entry())).toEqual({});
  });
});

const roundTripSuite = (name: string, make: () => CacheStore): void => {
  describe(name, () => {
    it("round-trips an entry (get after set)", () => {
      const store = make();
      store.set("k", entry({ etag: 'W/"v1"' }));
      expect(store.get("k")).toEqual(entry({ etag: 'W/"v1"' }));
    });
    it("returns undefined for an absent key", () => {
      expect(make().get("absent")).toBeUndefined();
    });
    it("upserts (a second set replaces)", () => {
      const store = make();
      store.set("k", entry({ body: "one" }));
      store.set("k", entry({ body: "two" }));
      expect(store.get("k")?.body).toBe("two");
    });
    it("deletes", () => {
      const store = make();
      store.set("k", entry());
      store.delete("k");
      expect(store.get("k")).toBeUndefined();
    });
  });
};

roundTripSuite("createMemoryCacheStore", createMemoryCacheStore);

describe("createSqliteCacheStore", () => {
  let db: Db;
  afterEach(() => db.close());
  const make = (): CacheStore => {
    db = openDatabase(":memory:");
    return createSqliteCacheStore(db);
  };

  // Reuse the shared contract against a real in-memory SQLite DB.
  roundTripSuite("contract", () => {
    db = openDatabase(":memory:");
    return createSqliteCacheStore(db);
  });

  it("creates its own http_cache table (not a migration)", () => {
    const store = make();
    store.set("k", entry());
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((t) => t.name);
    expect(tables).toContain("http_cache");
  });

  it("degrades a corrupt headers blob to no headers (never throws)", () => {
    const store = make();
    db.prepare(
      "INSERT INTO http_cache (key, status, headers, body, stored_at_ms, ttl_ms) VALUES ('k', 200, 'garbage', 'b', 1, 1)",
    ).run();
    expect(store.get("k")?.headers).toEqual({});
  });
});
