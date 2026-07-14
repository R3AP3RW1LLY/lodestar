import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client.js";
import type { ApiClientDeps } from "./client.js";
import { createGateway } from "./gateway.js";
import type { FetchFn } from "./gateway.js";
import { createMemoryCacheStore } from "./cache.js";
import { createRateLimiter } from "./rate-limiter.js";

const URL_A = "https://www.edsm.net/api/systems";

function makeClient(fetchFn: FetchFn, over: Partial<ApiClientDeps> = {}) {
  const clock = { t: 1_000_000 };
  const deps: ApiClientDeps = {
    gateway: createGateway({ fetchFn }),
    rateLimiter: createRateLimiter({ "www.edsm.net": { maxRequests: 10, windowMs: 60_000 } }),
    cache: createMemoryCacheStore(),
    now: () => clock.t,
    sleep: async () => {
      await Promise.resolve();
    },
    rand: () => 0.5,
    ...over,
  };
  return { client: createApiClient(deps), clock, deps };
}

const resp = (status: number, headers: Record<string, string>, body: string): Response =>
  new Response(status === 204 || status === 304 ? null : body, { status, headers });

describe("createApiClient — caching", () => {
  it("caches a 2xx and serves the second call from cache without a network hit", async () => {
    const fetchFn = vi.fn().mockResolvedValue(resp(200, { etag: 'W/"1"' }, "first"));
    const { client } = makeClient(fetchFn);

    const a = await client.request({ url: URL_A, ttlMs: 10_000 });
    expect(a.ok && a.value).toMatchObject({
      status: 200,
      body: "first",
      fromCache: false,
      ageMs: 0,
    });

    const b = await client.request({ url: URL_A, ttlMs: 10_000 });
    expect(b.ok && b.value.fromCache).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce(); // no second network call
  });

  it("stamps data-age when serving from cache", async () => {
    const fetchFn = vi.fn().mockResolvedValue(resp(200, {}, "x"));
    const { client, clock } = makeClient(fetchFn);
    await client.request({ url: URL_A, ttlMs: 10_000 });
    clock.t += 3000;
    const b = await client.request({ url: URL_A, ttlMs: 10_000 });
    expect(b.ok && b.value.ageMs).toBe(3000);
  });

  it("does not cache a non-2xx response", async () => {
    const fetchFn = vi.fn().mockImplementation(() => resp(404, {}, "nope")); // fresh response each call
    const { client } = makeClient(fetchFn);
    await client.request({ url: URL_A, ttlMs: 10_000 });
    await client.request({ url: URL_A, ttlMs: 10_000 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("revalidates a stale entry: 304 serves the cached body and refreshes the TTL", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(resp(200, { etag: 'W/"1"' }, "cached-body"))
      .mockResolvedValueOnce(resp(304, {}, ""));
    const { client, clock } = makeClient(fetchFn);
    await client.request({ url: URL_A, ttlMs: 5000 });
    clock.t += 6000; // now stale
    const b = await client.request({ url: URL_A, ttlMs: 5000 });
    expect(b.ok && b.value).toMatchObject({ body: "cached-body", fromCache: true });
    // The conditional request carried the validator.
    const secondInit = fetchFn.mock.calls[1]?.[1] as RequestInit;
    expect(new Headers(secondInit.headers).get("if-none-match")).toBe('W/"1"');
  });

  it("revalidates a stale entry: a fresh 200 replaces the cached body", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(resp(200, {}, "old"))
      .mockResolvedValueOnce(resp(200, {}, "new"));
    const { client, clock } = makeClient(fetchFn);
    await client.request({ url: URL_A, ttlMs: 1000 });
    clock.t += 2000;
    const b = await client.request({ url: URL_A, ttlMs: 1000 });
    expect(b.ok && b.value).toMatchObject({ body: "new", fromCache: false });
  });
});

describe("createApiClient — rate limiting", () => {
  it("refuses when out of tokens and no cache entry exists", async () => {
    const fetchFn = vi.fn().mockResolvedValue(resp(200, {}, "x"));
    const { client } = makeClient(fetchFn, {
      rateLimiter: createRateLimiter({ "www.edsm.net": { maxRequests: 1, windowMs: 60_000 } }),
    });
    await client.request({ url: URL_A, ttlMs: 0 }); // consume the only token (ttl 0 → not cached)
    const b = await client.request({ url: URL_A, ttlMs: 0 });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error.code).toBe("egress.rate-limited");
  });

  it("serves a stale cache entry instead of refusing when rate limited", async () => {
    const fetchFn = vi.fn().mockResolvedValue(resp(200, {}, "cached"));
    const { client, clock } = makeClient(fetchFn, {
      rateLimiter: createRateLimiter({ "www.edsm.net": { maxRequests: 1, windowMs: 60_000 } }),
    });
    await client.request({ url: URL_A, ttlMs: 1000 }); // caches + consumes the token
    clock.t += 2000; // stale
    const b = await client.request({ url: URL_A, ttlMs: 1000 });
    expect(b.ok && b.value).toMatchObject({ body: "cached", fromCache: true });
  });
});

describe("createApiClient — backoff", () => {
  it("retries a 503 then serves the 200, sleeping between", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(resp(503, {}, ""))
      .mockResolvedValueOnce(resp(200, {}, "ok"));
    const sleep = vi.fn(async () => {
      await Promise.resolve();
    });
    const { client } = makeClient(fetchFn, { sleep });
    const r = await client.request({ url: URL_A, ttlMs: 0 });
    expect(r.ok && r.value.body).toBe("ok");
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });
});

describe("createApiClient — egress safety still enforced by the gateway", () => {
  it("propagates a gateway refusal for a non-allowlisted host WITHOUT retrying", async () => {
    const fetchFn = vi.fn(); // must never be called
    const { client } = makeClient(fetchFn);
    const r = await client.request({ url: "https://api.openai.com/v1/chat", ttlMs: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("egress.host-not-allowed");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("rejects a malformed URL", async () => {
    const { client } = makeClient(vi.fn());
    const r = await client.request({ url: "not a url", ttlMs: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("egress.bad-url");
  });
});
