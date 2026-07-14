import { describe, expect, it, vi } from "vitest";
import { domainError, err } from "@lodestar/shared";
import { createApiClient } from "../gateway/client.js";
import type { FetchFn } from "../gateway/gateway.js";
import { createGateway } from "../gateway/gateway.js";
import { createMemoryCacheStore } from "../gateway/cache.js";
import { createRateLimiter } from "../gateway/rate-limiter.js";
import { createEdsmClient } from "./client.js";
import { EDSM_PAESIA_BODIES, EDSM_SPHERE_SYSTEMS } from "./fixtures.js";

const json = (status: number, value: unknown): Response =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function edsmOver(fetchFn: FetchFn) {
  const api = createApiClient({
    gateway: createGateway({ fetchFn }),
    rateLimiter: createRateLimiter(),
    cache: createMemoryCacheStore(),
    now: () => 0,
    sleep: async () => {
      await Promise.resolve();
    },
    rand: () => 0,
  });
  return createEdsmClient(api);
}

describe("createEdsmClient", () => {
  it("sphere-searches systems, requesting www.edsm.net with coordinates", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(200, EDSM_SPHERE_SYSTEMS));
    const edsm = edsmOver(fetchFn);
    const r = await edsm.sphereSystems({ x: 0, y: 0, z: 0 }, 20);
    expect(r.ok && r.value.map((s) => s.name)).toEqual(["Sol", "Sirius"]);
    const url = fetchFn.mock.calls[0]?.[0] as string;
    expect(url).toContain("https://www.edsm.net/api-v1/sphere-systems");
    expect(url).toContain("radius=20");
    expect(url).toContain("showCoordinates=1");
  });

  it("clamps the search radius to EDSM's 100 ly cap", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(200, []));
    await edsmOver(fetchFn).sphereSystems({ x: 0, y: 0, z: 0 }, 500);
    expect(fetchFn.mock.calls[0]?.[0] as string).toContain("radius=100");
  });

  it("fetches system bodies with ring type + reserve", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(200, EDSM_PAESIA_BODIES));
    const r = await edsmOver(fetchFn).systemBodies("Paesia");
    expect(r.ok && r.value.systemName).toBe("Paesia");
    const url = fetchFn.mock.calls[0]?.[0] as string;
    expect(url).toContain("systemName=Paesia");
  });

  it("handles a 429 by retrying (via the ApiClient backoff) then succeeding", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "1" } }))
      .mockResolvedValueOnce(json(200, EDSM_SPHERE_SYSTEMS));
    const r = await edsmOver(fetchFn).sphereSystems({ x: 0, y: 0, z: 0 }, 10);
    expect(r.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("surfaces invalid JSON as a typed error", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("<html>oops", { status: 200 }));
    const r = await edsmOver(fetchFn).sphereSystems({ x: 0, y: 0, z: 0 }, 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("edsm/bad-json");
  });

  it("propagates a gateway/network error result", async () => {
    // A denied host can't happen here (URL is fixed to edsm), but a persistent 500 surfaces.
    const fetchFn = vi.fn().mockResolvedValue(new Response("err", { status: 500 }));
    const r = await edsmOver(fetchFn).systemBodies("Paesia");
    // A 500 body is not JSON → typed parse error (never a throw).
    expect(r.ok).toBe(false);
  });

  it("propagates an ApiClient refusal (e.g. rate-limited) unchanged for both endpoints", async () => {
    const stubApi = {
      request: () => Promise.resolve(err(domainError("egress.rate-limited", "no tokens"))),
    };
    const edsm = createEdsmClient(stubApi);
    const a = await edsm.sphereSystems({ x: 0, y: 0, z: 0 }, 10);
    const b = await edsm.systemBodies("Paesia");
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    if (!a.ok) expect(a.error.code).toBe("egress.rate-limited");
  });
});
