import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../gateway/client.js";
import type { ApiClientDeps } from "../gateway/client.js";
import { createGateway } from "../gateway/gateway.js";
import type { FetchFn } from "../gateway/gateway.js";
import { createMemoryCacheStore } from "../gateway/cache.js";
import { createRateLimiter } from "../gateway/rate-limiter.js";
import { createInaraClient } from "./client.js";
import type { CommodityQuery, InaraConfig } from "./client.js";
import { INARA_BAD_KEY, INARA_PRICES_OK } from "./fixtures.js";

const CONFIG: InaraConfig = {
  appName: "LODESTAR",
  appVersion: "0.1.0",
  apiKey: "fixture-key-do-not-use",
  commanderName: "TestCmdr",
};

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

function inaraOver(
  fetchFn: FetchFn,
  config: InaraConfig,
  over: Partial<ApiClientDeps> = {},
  maxEvents?: number,
) {
  const api = createApiClient({
    gateway: createGateway({ fetchFn }),
    rateLimiter: createRateLimiter(),
    cache: createMemoryCacheStore(),
    now: () => 0,
    sleep: async () => {
      await Promise.resolve();
    },
    rand: () => 0,
    ...over,
  });
  return createInaraClient({
    api,
    config,
    nowIso: () => "2025-06-01T00:00:00Z",
    ...(maxEvents === undefined ? {} : { maxEventsPerRequest: maxEvents }),
  });
}

describe("createInaraClient — feature flag", () => {
  it("is disabled without an API key and makes NO network call", async () => {
    const fetchFn = vi.fn();
    const inara = inaraOver(fetchFn, { appName: "L", appVersion: "0" }); // no apiKey
    expect(inara.isEnabled()).toBe(false);
    const r = await inara.commodityPrices([{ commodityId: "painite" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("inara/disabled");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("is enabled with an API key", () => {
    expect(inaraOver(vi.fn(), CONFIG).isEnabled()).toBe(true);
  });
});

describe("createInaraClient — market reference", () => {
  it("POSTs the inapi/v1 envelope with the API key and parses prices", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(INARA_PRICES_OK));
    const inara = inaraOver(fetchFn, CONFIG);
    const r = await inara.commodityPrices([{ commodityId: "painite" }]);
    expect(r.ok && r.value.map((p) => p.commodityId)).toEqual(["painite", "opal"]);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://inara.cz/inapi/v1/");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as {
      header: { APIkey: string };
      events: unknown[];
    };
    expect(body.header.APIkey).toBe(CONFIG.apiKey);
    expect(body.events).toHaveLength(1);
  });

  it("returns [] for an empty (or unresolvable) query set without a network call", async () => {
    const fetchFn = vi.fn();
    const r = await inaraOver(fetchFn, CONFIG).commodityPrices([]);
    expect(r.ok && r.value).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("batches queries into as few POSTs as the per-request cap allows", async () => {
    const fetchFn = vi
      .fn()
      .mockImplementation(() => json({ header: { eventStatus: 200 }, events: [] }));
    const inara = inaraOver(
      fetchFn,
      CONFIG,
      { rateLimiter: createRateLimiter({ "inara.cz": { maxRequests: 100, windowMs: 60_000 } }) },
      2, // max 2 events/request
    );
    const queries: CommodityQuery[] = [
      { commodityId: "painite" },
      { commodityId: "platinum" },
      { commodityId: "gold" },
      { commodityId: "osmium" },
      { commodityId: "opal" },
    ];
    await inara.commodityPrices(queries);
    expect(fetchFn).toHaveBeenCalledTimes(3); // 2 + 2 + 1
  });

  it("surfaces an Inara API error (invalid key response)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(INARA_BAD_KEY));
    const r = await inaraOver(fetchFn, CONFIG).commodityPrices([{ commodityId: "painite" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("inara/api-error");
  });

  it("surfaces invalid JSON", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("<html>", { status: 200 }));
    const r = await inaraOver(fetchFn, CONFIG).commodityPrices([{ commodityId: "painite" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("inara/bad-json");
  });

  it("enforces the §5.3 rate policy (≤ 2 req/min) through the ApiClient", async () => {
    const fetchFn = vi
      .fn()
      .mockImplementation(() => json({ header: { eventStatus: 200 }, events: [] }));
    const inara = inaraOver(fetchFn, CONFIG, {
      rateLimiter: createRateLimiter({ "inara.cz": { maxRequests: 2, windowMs: 60_000 } }),
    });
    const q: CommodityQuery[] = [{ commodityId: "painite" }];
    expect((await inara.commodityPrices(q)).ok).toBe(true);
    expect((await inara.commodityPrices(q)).ok).toBe(true);
    const third = await inara.commodityPrices(q);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.error.code).toBe("egress.rate-limited");
  });
});
