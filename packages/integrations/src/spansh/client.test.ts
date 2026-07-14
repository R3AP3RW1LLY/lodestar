import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../gateway/client.js";
import type { FetchFn } from "../gateway/gateway.js";
import { createGateway } from "../gateway/gateway.js";
import { createMemoryCacheStore } from "../gateway/cache.js";
import { createRateLimiter } from "../gateway/rate-limiter.js";
import { createSpanshClient, parseJobId, parseRouteResult } from "./client.js";

const json = (value: unknown): Response =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const ROUTE_RESULT = {
  status: "ok",
  result: {
    distance: 84.2,
    system_jumps: [
      { system: "Paesia", jumps: 0 },
      { system: "Midway", jumps: 3 },
      { system: "Sol", jumps: 2 },
    ],
  },
};

function spanshOver(fetchFn: FetchFn, maxPolls = 5) {
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
  const sleep = vi.fn(async () => {
    await Promise.resolve();
  });
  return { client: createSpanshClient({ api, sleep, maxPolls }), sleep };
}

describe("parse helpers", () => {
  it("parseJobId extracts the job id (or errors)", () => {
    expect(parseJobId({ job: "abc" })).toEqual({ ok: true, value: "abc" });
    expect(parseJobId({}).ok).toBe(false);
  });

  it("parseRouteResult distinguishes queued vs done and sums jumps", () => {
    expect(parseRouteResult({ status: "queued" })).toEqual({
      ok: true,
      value: { state: "queued" },
    });
    const done = parseRouteResult(ROUTE_RESULT);
    expect(done.ok && done.value).toEqual({
      state: "done",
      route: { distanceLy: 84.2, jumps: 5, systems: ["Paesia", "Midway", "Sol"] },
    });
    expect(parseRouteResult({ nope: 1 }).ok).toBe(false);
  });
});

describe("createSpanshClient", () => {
  it("submits a job, polls until done (sleeping between), and returns the route", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ job: "job-1" })) // submit
      .mockResolvedValueOnce(json({ status: "queued" })) // poll 1
      .mockResolvedValueOnce(json(ROUTE_RESULT)); // poll 2 → done
    const { client, sleep } = spanshOver(fetchFn);
    const r = await client.route({ from: "Paesia", to: "Sol", jumpRangeLy: 50 });
    expect(r.ok && r.value.jumps).toBe(5);
    expect(sleep).toHaveBeenCalledOnce(); // slept once between the two polls
    // The submit was a POST to spansh with the query params.
    const submitUrl = fetchFn.mock.calls[0]?.[0] as string;
    expect(submitUrl).toContain("https://spansh.co.uk/api/route");
    expect(submitUrl).toContain("source=Paesia");
  });

  it("errors when the job never finishes within maxPolls", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ job: "job-1" }))
      .mockImplementation(() => json({ status: "queued" })); // fresh response each poll
    const { client } = spanshOver(fetchFn, 3);
    const r = await client.route({ from: "A", to: "B", jumpRangeLy: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("spansh/timeout");
  });

  it("surfaces a missing job id", async () => {
    const fetchFn = vi.fn().mockResolvedValue(json({ notAJob: true }));
    const { client } = spanshOver(fetchFn);
    const r = await client.route({ from: "A", to: "B", jumpRangeLy: 50 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("spansh/no-job");
  });
});
