import { describe, expect, it } from "vitest";
import { DEFAULT_RATE_POLICIES, FALLBACK_RATE_POLICY, createRateLimiter } from "./rate-limiter.js";

describe("createRateLimiter", () => {
  it("allows a full bucket's worth of requests, then denies with a retry-after", () => {
    const rl = createRateLimiter({ "a.test": { maxRequests: 3, windowMs: 60_000 } });
    expect(rl.tryAcquire("a.test", 0).ok).toBe(true);
    expect(rl.tryAcquire("a.test", 0).ok).toBe(true);
    expect(rl.tryAcquire("a.test", 0).ok).toBe(true);
    const denied = rl.tryAcquire("a.test", 0);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
  });

  it("refills over time (one token back after window/maxRequests)", () => {
    const rl = createRateLimiter({ "a.test": { maxRequests: 2, windowMs: 60_000 } });
    rl.tryAcquire("a.test", 0);
    rl.tryAcquire("a.test", 0);
    expect(rl.tryAcquire("a.test", 0).ok).toBe(false);
    // One token refills after windowMs / maxRequests = 30_000 ms.
    expect(rl.tryAcquire("a.test", 30_000).ok).toBe(true);
  });

  it("isolates buckets per host", () => {
    const rl = createRateLimiter({
      "a.test": { maxRequests: 1, windowMs: 60_000 },
      "b.test": { maxRequests: 1, windowMs: 60_000 },
    });
    expect(rl.tryAcquire("a.test", 0).ok).toBe(true);
    expect(rl.tryAcquire("a.test", 0).ok).toBe(false);
    expect(rl.tryAcquire("b.test", 0).ok).toBe(true); // unaffected
  });

  it("uses the fallback policy for a host without a specific one", () => {
    const rl = createRateLimiter({}, { maxRequests: 1, windowMs: 60_000 });
    expect(rl.tryAcquire("unknown.test", 0).ok).toBe(true);
    expect(rl.tryAcquire("unknown.test", 0).ok).toBe(false);
  });

  it("never over-fills the bucket beyond capacity after a long idle", () => {
    const rl = createRateLimiter({ "a.test": { maxRequests: 2, windowMs: 60_000 } });
    rl.tryAcquire("a.test", 0);
    // A huge gap must not accumulate more than `maxRequests` tokens.
    expect(rl.tryAcquire("a.test", 10_000_000).ok).toBe(true);
    expect(rl.tryAcquire("a.test", 10_000_000).ok).toBe(true);
    expect(rl.tryAcquire("a.test", 10_000_000).ok).toBe(false);
  });

  it("encodes the §5.3 sustained limits", () => {
    expect(DEFAULT_RATE_POLICIES["www.edsm.net"]).toEqual({ maxRequests: 10, windowMs: 60_000 });
    expect(DEFAULT_RATE_POLICIES["spansh.co.uk"]).toEqual({ maxRequests: 6, windowMs: 60_000 });
    expect(DEFAULT_RATE_POLICIES["inara.cz"]).toEqual({ maxRequests: 2, windowMs: 60_000 });
    expect(DEFAULT_RATE_POLICIES["companion.orerve.net"]).toEqual({
      maxRequests: 1,
      windowMs: 300_000,
    });
    expect(FALLBACK_RATE_POLICY).toEqual({ maxRequests: 4, windowMs: 60_000 });
  });
});
