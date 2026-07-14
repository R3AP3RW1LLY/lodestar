/**
 * Exponential backoff with full jitter (SSOT §5.3, Step 4.6). Retries only the
 * transient statuses (429 + 5xx); honours a `Retry-After` header when present.
 * Pure math + explicit `sleep`/`rand`/`now` injection, so retry behaviour is
 * deterministically testable offline.
 */

export interface BackoffOptions {
  readonly baseMs: number;
  readonly maxMs: number;
  readonly factor: number;
  readonly maxAttempts: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
  baseMs: 500,
  maxMs: 30_000,
  factor: 2,
  maxAttempts: 4,
};

const EXPLICIT_RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** A response is worth retrying iff it's 429 or any 5xx. */
export function isRetryableStatus(status: number): boolean {
  return EXPLICIT_RETRYABLE.has(status) || (status >= 500 && status < 600);
}

/**
 * Full-jitter exponential backoff: a random delay in `[0, min(maxMs, base·factorᵃᵗᵗᵉᵐᵖᵗ)]`.
 * `attempt` is 0-based; `rand` returns `[0,1)`.
 */
export function backoffDelayMs(
  attempt: number,
  rand: () => number,
  opts: BackoffOptions = DEFAULT_BACKOFF,
): number {
  const ceiling = Math.min(opts.maxMs, opts.baseMs * opts.factor ** Math.max(attempt, 0));
  return Math.floor(rand() * ceiling);
}

/** Parse a `Retry-After` header (delta-seconds or an HTTP-date) to ms, or undefined. */
export function parseRetryAfterMs(header: string | null, nowMs: number): number | undefined {
  if (header === null || header.trim() === "") return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(header);
  return Number.isNaN(dateMs) ? undefined : Math.max(0, dateMs - nowMs);
}

export interface RetryDeps {
  readonly sleep: (ms: number) => Promise<void>;
  readonly rand: () => number;
  readonly now: () => number;
}

/**
 * Run `attempt` up to `maxAttempts` times, retrying while the response is transient
 * (429/5xx). Waits for `Retry-After` if the server sent it, else a jittered backoff.
 * Returns the last response either way (the caller decides how to treat a final 5xx).
 */
export async function withRetry(
  attempt: () => Promise<Response>,
  deps: RetryDeps,
  opts: BackoffOptions = DEFAULT_BACKOFF,
): Promise<Response> {
  let response = await attempt();
  for (let i = 1; i < opts.maxAttempts && isRetryableStatus(response.status); i++) {
    const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"), deps.now());
    await deps.sleep(retryAfter ?? backoffDelayMs(i - 1, deps.rand, opts));
    response = await attempt();
  }
  return response;
}
