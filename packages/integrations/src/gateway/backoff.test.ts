import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_BACKOFF,
  backoffDelayMs,
  isRetryableStatus,
  parseRetryAfterMs,
  withRetry,
} from "./backoff.js";

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response("", { status, headers });
}

describe("isRetryableStatus", () => {
  it.each([429, 500, 502, 503, 504, 599])("retries %s", (s) => {
    expect(isRetryableStatus(s)).toBe(true);
  });
  it.each([200, 301, 400, 401, 403, 404])("does not retry %s", (s) => {
    expect(isRetryableStatus(s)).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("stays within [0, ceiling] and grows the ceiling exponentially", () => {
    const opts = { baseMs: 500, maxMs: 30_000, factor: 2, maxAttempts: 5 };
    expect(backoffDelayMs(0, () => 0, opts)).toBe(0);
    expect(backoffDelayMs(0, () => 0.999, opts)).toBeLessThan(500);
    expect(backoffDelayMs(2, () => 0.999, opts)).toBeLessThan(2000); // 500·2² = 2000
    expect(backoffDelayMs(2, () => 0.999, opts)).toBeGreaterThan(1000);
  });

  it("clamps the ceiling at maxMs", () => {
    const opts = { baseMs: 500, maxMs: 1000, factor: 2, maxAttempts: 9 };
    expect(backoffDelayMs(20, () => 0.999, opts)).toBeLessThan(1000);
  });
});

describe("parseRetryAfterMs", () => {
  it("parses delta-seconds", () => {
    expect(parseRetryAfterMs("30", 0)).toBe(30_000);
  });
  it("parses an HTTP-date relative to now", () => {
    const now = Date.parse("2025-06-01T00:00:00Z");
    expect(parseRetryAfterMs("Sun, 01 Jun 2025 00:00:10 GMT", now)).toBe(10_000);
  });
  it("returns undefined for a missing / empty / garbage header", () => {
    expect(parseRetryAfterMs(null, 0)).toBeUndefined();
    expect(parseRetryAfterMs("  ", 0)).toBeUndefined();
    expect(parseRetryAfterMs("soon", 0)).toBeUndefined();
  });
});

describe("withRetry", () => {
  const deps = (delays: number[]) => ({
    sleep: vi.fn(async (ms: number) => {
      delays.push(ms);
      await Promise.resolve();
    }),
    rand: () => 0.5,
    now: () => 0,
  });

  it("returns immediately on a non-retryable status", async () => {
    const delays: number[] = [];
    const attempt = vi.fn().mockResolvedValue(response(200));
    const res = await withRetry(attempt, deps(delays));
    expect(res.status).toBe(200);
    expect(attempt).toHaveBeenCalledOnce();
    expect(delays).toEqual([]);
  });

  it("retries a 503 then succeeds, sleeping between attempts", async () => {
    const delays: number[] = [];
    const attempt = vi
      .fn()
      .mockResolvedValueOnce(response(503))
      .mockResolvedValueOnce(response(200));
    const res = await withRetry(attempt, deps(delays));
    expect(res.status).toBe(200);
    expect(attempt).toHaveBeenCalledTimes(2);
    expect(delays).toHaveLength(1);
  });

  it("honours Retry-After over computed backoff", async () => {
    const delays: number[] = [];
    const attempt = vi
      .fn()
      .mockResolvedValueOnce(response(429, { "retry-after": "5" }))
      .mockResolvedValueOnce(response(200));
    await withRetry(attempt, deps(delays));
    expect(delays[0]).toBe(5000);
  });

  it("gives up after maxAttempts, returning the last (still-failing) response", async () => {
    const delays: number[] = [];
    const attempt = vi.fn().mockResolvedValue(response(500));
    const res = await withRetry(attempt, deps(delays), { ...DEFAULT_BACKOFF, maxAttempts: 3 });
    expect(res.status).toBe(500);
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(delays).toHaveLength(2); // slept between the 3 attempts
  });
});
