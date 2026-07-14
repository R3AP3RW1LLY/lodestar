/**
 * Spansh routing client (SSOT Step 4.12b). Spansh is an ASYNC job API: submit a route
 * request → get a job id → poll the results endpoint (≥ 2 s interval, §5.3) until it's
 * ready. All through the Step-4.6 ApiClient, so the ≤ 6 req/min rate limit + backoff
 * apply. Returns the route's jump count + distance for the planner's legs — it computes
 * NOTHING about controlling the game; a route is data the player copies by hand.
 *
 * The exact Spansh endpoint paths + result schema are PROVISIONAL (verified against live
 * Spansh before shipping); parsing is tolerant.
 */

import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";
import type { ApiClient } from "../gateway/client.js";

const SPANSH_ORIGIN = "https://spansh.co.uk";
const MIN_POLL_INTERVAL_MS = 2000; // §5.3: poll jobs ≥ 2 s apart
const DEFAULT_MAX_POLLS = 30;

export interface SpanshRoute {
  readonly distanceLy: number;
  readonly jumps: number;
  readonly systems: readonly string[];
}

export interface SpanshRouteParams {
  readonly from: string;
  readonly to: string;
  readonly jumpRangeLy: number;
}

export interface SpanshDeps {
  readonly api: ApiClient;
  readonly sleep: (ms: number) => Promise<void>;
  readonly pollIntervalMs?: number;
  readonly maxPolls?: number;
}

export interface SpanshClient {
  route: (params: SpanshRouteParams) => Promise<Result<SpanshRoute, DomainError>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(body: string): Result<unknown, DomainError> {
  try {
    return ok(JSON.parse(body));
  } catch {
    return err(domainError("spansh/bad-json", "Spansh response was not valid JSON"));
  }
}

/** Parse the job-submit response ({ job: "<id>" }). */
export function parseJobId(raw: unknown): Result<string, DomainError> {
  if (!isRecord(raw) || typeof raw.job !== "string") {
    return err(domainError("spansh/no-job", "Spansh did not return a job id"));
  }
  return ok(raw.job);
}

export type SpanshPoll =
  { readonly state: "queued" } | { readonly state: "done"; readonly route: SpanshRoute };

/** Parse a results poll: `queued` (still running) or `done` with the route. */
export function parseRouteResult(raw: unknown): Result<SpanshPoll, DomainError> {
  if (!isRecord(raw) || typeof raw.status !== "string") {
    return err(domainError("spansh/bad-result", "malformed Spansh result"));
  }
  if (raw.status === "queued") return ok({ state: "queued" });
  const result = raw.result;
  if (!isRecord(result)) return err(domainError("spansh/bad-result", "result missing"));
  const systemsRaw = Array.isArray(result.system_jumps) ? result.system_jumps : [];
  const systems = systemsRaw
    .filter(isRecord)
    .map((s) => (typeof s.system === "string" ? s.system : ""))
    .filter((s) => s.length > 0);
  const jumps = systemsRaw
    .filter(isRecord)
    .reduce((n, s) => n + (typeof s.jumps === "number" ? s.jumps : 0), 0);
  const distanceLy = typeof result.distance === "number" ? result.distance : 0;
  return ok({ state: "done", route: { distanceLy, jumps, systems } });
}

export function createSpanshClient(deps: SpanshDeps): SpanshClient {
  const pollInterval = Math.max(MIN_POLL_INTERVAL_MS, deps.pollIntervalMs ?? MIN_POLL_INTERVAL_MS);
  const maxPolls = deps.maxPolls ?? DEFAULT_MAX_POLLS;

  return {
    async route(params) {
      const query = new URLSearchParams({
        source: params.from,
        destination: params.to,
        range: String(params.jumpRangeLy),
      });
      const submit = await deps.api.request({
        url: `${SPANSH_ORIGIN}/api/route?${query.toString()}`,
        ttlMs: 0,
        init: { method: "POST" },
      });
      if (!submit.ok) return err(submit.error);
      const submitJson = parseJson(submit.value.body);
      if (!submitJson.ok) return err(submitJson.error);
      const jobId = parseJobId(submitJson.value);
      if (!jobId.ok) return err(jobId.error);

      for (let poll = 0; poll < maxPolls; poll++) {
        const results = await deps.api.request({
          url: `${SPANSH_ORIGIN}/api/results/${jobId.value}`,
          ttlMs: 0,
        });
        if (!results.ok) return err(results.error);
        const json = parseJson(results.value.body);
        if (!json.ok) return err(json.error);
        const parsed = parseRouteResult(json.value);
        if (!parsed.ok) return err(parsed.error);
        if (parsed.value.state === "done") return ok(parsed.value.route);
        await deps.sleep(pollInterval);
      }
      return err(
        domainError("spansh/timeout", `route job did not finish in ${String(maxPolls)} polls`),
      );
    },
  };
}
