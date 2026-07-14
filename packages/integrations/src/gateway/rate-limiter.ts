/**
 * Per-host token-bucket rate limiting (SSOT §5.3, Step 4.6). Each host has a sustained
 * limit (`maxRequests` per `windowMs`); a bucket starts full and refills linearly. A
 * host without an explicit policy uses the conservative fallback. Pure + deterministic:
 * the clock is passed in (`nowMs`), so limiting is testable without real time.
 */

export interface RatePolicy {
  readonly maxRequests: number;
  readonly windowMs: number;
}

export interface RateLimitResult {
  readonly ok: boolean;
  /** When `ok` is false, ms until at least one token is available again. */
  readonly retryAfterMs: number;
}

/** §5.3 sustained per-host limits. */
export const DEFAULT_RATE_POLICIES: Readonly<Record<string, RatePolicy>> = {
  "www.edsm.net": { maxRequests: 10, windowMs: 60_000 },
  "spansh.co.uk": { maxRequests: 6, windowMs: 60_000 },
  "inara.cz": { maxRequests: 2, windowMs: 60_000 },
  "companion.orerve.net": { maxRequests: 1, windowMs: 300_000 }, // ≤ 1 profile poll / 5 min
};

/** The default for any allowlisted host without a specific policy (e.g. the community endpoint). */
export const FALLBACK_RATE_POLICY: RatePolicy = { maxRequests: 4, windowMs: 60_000 };

export interface RateLimiter {
  /** Try to consume one token for `host` at `nowMs`. */
  tryAcquire: (host: string, nowMs: number) => RateLimitResult;
}

interface Bucket {
  tokens: number;
  lastMs: number;
}

export function createRateLimiter(
  policies: Readonly<Record<string, RatePolicy>> = DEFAULT_RATE_POLICIES,
  fallback: RatePolicy = FALLBACK_RATE_POLICY,
): RateLimiter {
  const buckets = new Map<string, Bucket>();
  return {
    tryAcquire(host, nowMs) {
      const policy = policies[host] ?? fallback;
      const ratePerMs = policy.maxRequests / policy.windowMs;
      const prior = buckets.get(host) ?? { tokens: policy.maxRequests, lastMs: nowMs };
      const elapsed = Math.max(0, nowMs - prior.lastMs);
      const tokens = Math.min(policy.maxRequests, prior.tokens + elapsed * ratePerMs);
      if (tokens >= 1) {
        buckets.set(host, { tokens: tokens - 1, lastMs: nowMs });
        return { ok: true, retryAfterMs: 0 };
      }
      buckets.set(host, { tokens, lastMs: nowMs });
      return { ok: false, retryAfterMs: Math.ceil((1 - tokens) / ratePerMs) };
    },
  };
}
