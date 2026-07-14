import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../gateway/client.js";
import type { FetchFn } from "../gateway/gateway.js";
import { createGateway } from "../gateway/gateway.js";
import { createMemoryCacheStore } from "../gateway/cache.js";
import { createRateLimiter } from "../gateway/rate-limiter.js";
import { createCapiClient } from "./client.js";
import type { CapiConfig, CapiTokenStore } from "./client.js";
import type { CapiToken } from "./oauth.js";

const memStore = (initial?: CapiToken): CapiTokenStore => {
  let token = initial;
  return {
    get: () => token,
    set: (t) => {
      token = t;
    },
    clear: () => {
      token = undefined;
    },
  };
};

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** A fake of the Frontier endpoints, dispatched by URL; records the urls + inits it saw. */
function frontierFetch(): { fetch: FetchFn; urls: string[]; inits: (RequestInit | undefined)[] } {
  const urls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    urls.push(url);
    inits.push(init);
    await Promise.resolve();
    if (url.endsWith("/token")) {
      return json({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        expires_in: 3600,
      });
    }
    if (url.endsWith("/profile")) return json({ commander: { name: "TestCmdr" } });
    if (url.endsWith("/market")) return json({ id: 128016640, name: "Nemere Terminal" });
    return new Response("not found", { status: 404 });
  });
  return { fetch, urls, inits };
}

function capiOver(fetchFn: FetchFn, config: CapiConfig, store: CapiTokenStore, now = () => 1000) {
  const api = createApiClient({
    gateway: createGateway({ fetchFn }),
    rateLimiter: createRateLimiter(),
    cache: createMemoryCacheStore(),
    now,
    sleep: async () => {
      await Promise.resolve();
    },
    rand: () => 0,
  });
  return createCapiClient({ api, tokenStore: store, config, now });
}

const ENABLED: CapiConfig = { clientId: "client-abc", enabled: true };
const DISABLED: CapiConfig = { clientId: "client-abc", enabled: false };
const liveToken: CapiToken = {
  accessToken: "live-access",
  refreshToken: "live-refresh",
  expiresAtMs: 10_000_000,
};

describe("createCapiClient — feature flag", () => {
  it("flag-off: profile() is disabled and makes NO network attempt", async () => {
    const { fetch, urls } = frontierFetch();
    const capi = capiOver(fetch, DISABLED, memStore(liveToken));
    expect(capi.isEnabled()).toBe(false);
    const r = await capi.profile();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("capi/disabled");
    expect(urls).toEqual([]);
  });

  it("enabled but unlinked: no token → capi/no-token, no network attempt", async () => {
    const { fetch, urls } = frontierFetch();
    const r = await capiOver(fetch, ENABLED, memStore()).profile();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("capi/no-token");
    expect(urls).toEqual([]);
  });
});

describe("createCapiClient — authed fetch", () => {
  it("fetches /profile with the stored Bearer token", async () => {
    const { fetch, urls, inits } = frontierFetch();
    const r = await capiOver(fetch, ENABLED, memStore(liveToken)).profile();
    expect(r.ok && r.value).toEqual({ commander: { name: "TestCmdr" } });
    expect(new Headers(inits[0]?.headers).get("authorization")).toBe("Bearer live-access");
    expect(urls).toEqual(["https://companion.orerve.net/profile"]);
  });

  it("fetches /market", async () => {
    const { fetch, urls } = frontierFetch();
    const r = await capiOver(fetch, ENABLED, memStore(liveToken)).market();
    expect(r.ok && r.value).toMatchObject({ name: "Nemere Terminal" });
    expect(urls).toEqual(["https://companion.orerve.net/market"]);
  });

  it("refreshes an expired token before fetching, and persists the new token in the store", async () => {
    const { fetch, urls, inits } = frontierFetch();
    const store = memStore({ accessToken: "old", refreshToken: "old-refresh", expiresAtMs: 500 });
    const r = await capiOver(fetch, ENABLED, store, () => 1000).profile(); // now=1000 > expiry 500
    expect(r.ok).toBe(true);
    // token endpoint hit first, then /profile with the fresh Bearer.
    expect(urls).toEqual([
      "https://auth.frontierstore.net/token",
      "https://companion.orerve.net/profile",
    ]);
    expect(store.get()?.accessToken).toBe("fresh-access"); // persisted only via the store
    expect(new Headers(inits[1]?.headers).get("authorization")).toBe("Bearer fresh-access");
  });

  it("propagates a refresh failure without fetching the resource", async () => {
    const fetchFn = vi.fn(async (url: string): Promise<Response> => {
      await Promise.resolve();
      if (url.endsWith("/token")) return new Response("{}", { status: 200 }); // malformed token
      return json({ should: "not reach" });
    });
    const store = memStore({ accessToken: "old", refreshToken: "old-refresh", expiresAtMs: 0 });
    const r = await capiOver(fetchFn, ENABLED, store, () => 1000).profile();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("capi/bad-token");
  });
});
