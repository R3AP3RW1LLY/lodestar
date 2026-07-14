/**
 * The client-quality layer (SSOT §5.3, Step 4.6) composed onto the Step-0.10 gateway:
 * cache → rate-limit → gateway (allowlist + manual redirects) → backoff, with a
 * **data-age stamp on every payload**. A fresh cache hit skips the network entirely; a
 * stale hit revalidates conditionally (304 ⇒ serve cached, refresh TTL). Rate-limited
 * requests serve a stale cache entry if one exists, else refuse. All the egress SAFETY
 * still comes from the wrapped gateway — this layer never opens a socket itself.
 */

import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";
import type { BackoffOptions } from "./backoff.js";
import {
  DEFAULT_BACKOFF,
  backoffDelayMs,
  isRetryableStatus,
  parseRetryAfterMs,
} from "./backoff.js";
import type { CacheStore, CachedResponse } from "./cache.js";
import { cacheKey, conditionalHeaders, lookupCache } from "./cache.js";
import type { Gateway } from "./gateway.js";
import type { RateLimiter } from "./rate-limiter.js";

export interface ApiClientDeps {
  readonly gateway: Gateway;
  readonly rateLimiter: RateLimiter;
  readonly cache: CacheStore;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly rand: () => number;
  readonly backoff?: BackoffOptions;
}

export interface ApiRequest {
  readonly url: string;
  /** Per-source cache TTL (ms) for a successful response. 0 disables caching this call. */
  readonly ttlMs: number;
  readonly init?: RequestInit;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: string;
  /** Age of the payload (ms): 0 for a fresh network fetch, `now − storedAt` when served from cache. */
  readonly ageMs: number;
  readonly fromCache: boolean;
}

export interface ApiClient {
  request: (req: ApiRequest) => Promise<Result<ApiResponse, DomainError>>;
}

function headerRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function served(entry: CachedResponse, ageMs: number): ApiResponse {
  return { status: entry.status, body: entry.body, ageMs, fromCache: true };
}

export function createApiClient(deps: ApiClientDeps): ApiClient {
  const backoff = deps.backoff ?? DEFAULT_BACKOFF;

  return {
    async request(req: ApiRequest): Promise<Result<ApiResponse, DomainError>> {
      let host: string;
      try {
        host = new URL(req.url).host;
      } catch {
        return err(domainError("egress.bad-url", `Not a valid URL: ${req.url}`));
      }
      const key = cacheKey("GET", req.url);
      const cached = lookupCache(deps.cache, key, deps.now());
      if (cached.state === "fresh") return ok(served(cached.entry, cached.ageMs));
      const stale = cached.state === "stale" ? cached.entry : undefined;

      // Rate limit: if we're out of tokens, serve stale rather than nothing; else refuse.
      const gate = deps.rateLimiter.tryAcquire(host, deps.now());
      if (!gate.ok) {
        if (stale !== undefined) return ok(served(stale, deps.now() - stale.storedAtMs));
        return err(
          domainError(
            "egress.rate-limited",
            `${host}: rate limited, retry in ${String(gate.retryAfterMs)}ms`,
          ),
        );
      }

      const baseInit = req.init ?? {};
      const headers = new Headers(baseInit.headers);
      if (stale !== undefined) {
        for (const [name, value] of Object.entries(conditionalHeaders(stale))) {
          headers.set(name, value);
        }
      }
      const init: RequestInit = { ...baseInit, headers };

      let response: Response | undefined;
      for (let attempt = 0; attempt < backoff.maxAttempts; attempt++) {
        const result = await deps.gateway.request(req.url, init);
        if (!result.ok) return err(result.error); // allowlist/redirect refusal — never retried
        response = result.value;
        if (response.status === 304 && stale !== undefined) {
          const refreshed: CachedResponse = { ...stale, storedAtMs: deps.now(), ttlMs: req.ttlMs };
          deps.cache.set(key, refreshed);
          return ok(served(refreshed, 0));
        }
        if (!isRetryableStatus(response.status)) break;
        if (attempt === backoff.maxAttempts - 1) break;
        const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"), deps.now());
        await deps.sleep(retryAfter ?? backoffDelayMs(attempt, deps.rand, backoff));
      }
      if (response === undefined) {
        return err(domainError("egress.no-response", `${host}: no response`));
      }

      const body = await response.text();
      if (response.status >= 200 && response.status < 300 && req.ttlMs > 0) {
        const headers = response.headers;
        const etag = headers.get("etag");
        const lastModified = headers.get("last-modified");
        deps.cache.set(key, {
          status: response.status,
          headers: headerRecord(headers),
          body,
          ...(etag === null ? {} : { etag }),
          ...(lastModified === null ? {} : { lastModified }),
          storedAtMs: deps.now(),
          ttlMs: req.ttlMs,
        });
      }
      return ok({ status: response.status, body, ageMs: 0, fromCache: false });
    },
  };
}
