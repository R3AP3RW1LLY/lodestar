/**
 * Response cache (SSOT §5.3, Step 4.6). A per-source-TTL cache with conditional
 * revalidation (ETag → `If-None-Match`, Last-Modified → `If-Modified-Since`). The
 * cache LOGIC (freshness, conditional headers, age stamping) is pure over a small
 * `CacheStore` interface; two stores ship — an in-memory one and a SQLite-backed one.
 *
 * The SQLite store owns its own `http_cache` table via `CREATE TABLE IF NOT EXISTS`
 * (ephemeral, regenerable infrastructure — like `schema_migrations`, NOT part of the
 * forward-only profile-migration chain, so cache rows are never migrated/preserved).
 */

import type { Db } from "@lodestar/data";

export interface CachedResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly storedAtMs: number;
  readonly ttlMs: number;
}

export interface CacheStore {
  get: (key: string) => CachedResponse | undefined;
  set: (key: string, entry: CachedResponse) => void;
  delete: (key: string) => void;
}

export type CacheLookup =
  | { readonly state: "fresh"; readonly entry: CachedResponse; readonly ageMs: number }
  | { readonly state: "stale"; readonly entry: CachedResponse; readonly ageMs: number }
  | { readonly state: "miss" };

/** Cache key = method + URL (method uppercased). */
export function cacheKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

/** Classify a stored entry at `nowMs`: fresh (within TTL), stale (revalidatable), or a miss. */
export function lookupCache(store: CacheStore, key: string, nowMs: number): CacheLookup {
  const entry = store.get(key);
  if (entry === undefined) return { state: "miss" };
  const ageMs = Math.max(0, nowMs - entry.storedAtMs);
  return ageMs < entry.ttlMs ? { state: "fresh", entry, ageMs } : { state: "stale", entry, ageMs };
}

/** Conditional-request headers for a stale entry (empty if it carries neither validator). */
export function conditionalHeaders(entry: CachedResponse): Record<string, string> {
  const headers: Record<string, string> = {};
  if (entry.etag !== undefined) headers["If-None-Match"] = entry.etag;
  if (entry.lastModified !== undefined) headers["If-Modified-Since"] = entry.lastModified;
  return headers;
}

// ── In-memory store ────────────────────────────────────────────────────────────
export function createMemoryCacheStore(): CacheStore {
  const map = new Map<string, CachedResponse>();
  return {
    get: (key) => map.get(key),
    set: (key, entry) => {
      map.set(key, entry);
    },
    delete: (key) => {
      map.delete(key);
    },
  };
}

// ── SQLite-backed store ──────────────────────────────────────────────────────────
export const HTTP_CACHE_SCHEMA = `CREATE TABLE IF NOT EXISTS http_cache (
  key           TEXT    PRIMARY KEY,
  status        INTEGER NOT NULL,
  headers       TEXT    NOT NULL,
  body          TEXT    NOT NULL,
  etag          TEXT,
  last_modified TEXT,
  stored_at_ms  INTEGER NOT NULL,
  ttl_ms        INTEGER NOT NULL
);`;

interface HttpCacheRow {
  readonly status: number;
  readonly headers: string;
  readonly body: string;
  readonly etag: string | null;
  readonly last_modified: string | null;
  readonly stored_at_ms: number;
  readonly ttl_ms: number;
}

function rowToEntry(row: HttpCacheRow): CachedResponse {
  let headers: Record<string, string> = {};
  try {
    const parsed: unknown = JSON.parse(row.headers);
    if (typeof parsed === "object" && parsed !== null) headers = parsed as Record<string, string>;
  } catch {
    /* a corrupt headers blob degrades to no headers — a read never throws */
  }
  return {
    status: row.status,
    headers,
    body: row.body,
    ...(row.etag === null ? {} : { etag: row.etag }),
    ...(row.last_modified === null ? {} : { lastModified: row.last_modified }),
    storedAtMs: row.stored_at_ms,
    ttlMs: row.ttl_ms,
  };
}

/** A SQLite-backed cache store; creates its own `http_cache` table on construction. */
export function createSqliteCacheStore(db: Db): CacheStore {
  db.exec(HTTP_CACHE_SCHEMA);
  const getStmt = db.prepare("SELECT * FROM http_cache WHERE key = ?");
  const setStmt = db.prepare(
    `INSERT INTO http_cache (key, status, headers, body, etag, last_modified, stored_at_ms, ttl_ms)
       VALUES (@key, @status, @headers, @body, @etag, @lastModified, @storedAtMs, @ttlMs)
     ON CONFLICT(key) DO UPDATE SET
       status = excluded.status, headers = excluded.headers, body = excluded.body,
       etag = excluded.etag, last_modified = excluded.last_modified,
       stored_at_ms = excluded.stored_at_ms, ttl_ms = excluded.ttl_ms`,
  );
  const deleteStmt = db.prepare("DELETE FROM http_cache WHERE key = ?");
  return {
    get: (key) => {
      const row = getStmt.get(key) as HttpCacheRow | undefined;
      return row === undefined ? undefined : rowToEntry(row);
    },
    set: (key, entry) => {
      setStmt.run({
        key,
        status: entry.status,
        headers: JSON.stringify(entry.headers),
        body: entry.body,
        etag: entry.etag ?? null,
        lastModified: entry.lastModified ?? null,
        storedAtMs: entry.storedAtMs,
        ttlMs: entry.ttlMs,
      });
    },
    delete: (key) => {
      deleteStmt.run(key);
    },
  };
}
