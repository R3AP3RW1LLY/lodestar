/**
 * EDSM client (SSOT Step 4.7). Sphere/cube system search + body/ring enrichment through
 * the Step-4.6 `ApiClient` (allowlist + rate limit + cache + backoff), so 429s and TTLs
 * are handled by that layer. Per §5.3: system coordinates cache 30 d, bodies/rings 7 d.
 * Returns parsed domain data (or a typed error); persistence is `enrich.ts`.
 */

import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";
import type { ApiClient } from "../gateway/client.js";
import type { EdsmSystem, EdsmSystemBodies } from "./parse.js";
import { parseEdsmBodies, parseEdsmSystems } from "./parse.js";

const EDSM_ORIGIN = "https://www.edsm.net";
const SYSTEMS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 d
const BODIES_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 d
/** EDSM caps a sphere/cube search at 100 ly. */
export const EDSM_MAX_RADIUS_LY = 100;

export interface EdsmClient {
  /** Systems within `radiusLy` of a galactic point (coordinates included). */
  sphereSystems: (
    center: { x: number; y: number; z: number },
    radiusLy: number,
  ) => Promise<Result<EdsmSystem[], DomainError>>;
  /** Bodies of a system, carrying ring type + reserve level. */
  systemBodies: (systemName: string) => Promise<Result<EdsmSystemBodies, DomainError>>;
}

function parseJson(body: string): Result<unknown, DomainError> {
  try {
    return ok(JSON.parse(body));
  } catch {
    return err(domainError("edsm/bad-json", "EDSM response was not valid JSON"));
  }
}

export function createEdsmClient(api: ApiClient): EdsmClient {
  return {
    async sphereSystems(center, radiusLy) {
      const radius = Math.min(Math.max(radiusLy, 0), EDSM_MAX_RADIUS_LY);
      const query = new URLSearchParams({
        x: String(center.x),
        y: String(center.y),
        z: String(center.z),
        radius: String(radius),
        showCoordinates: "1",
      });
      const result = await api.request({
        url: `${EDSM_ORIGIN}/api-v1/sphere-systems?${query.toString()}`,
        ttlMs: SYSTEMS_TTL_MS,
      });
      if (!result.ok) return err(result.error);
      const json = parseJson(result.value.body);
      if (!json.ok) return err(json.error);
      return parseEdsmSystems(json.value);
    },

    async systemBodies(systemName) {
      const query = new URLSearchParams({ systemName });
      const result = await api.request({
        url: `${EDSM_ORIGIN}/api-system-v1/bodies?${query.toString()}`,
        ttlMs: BODIES_TTL_MS,
      });
      if (!result.ok) return err(result.error);
      const json = parseJson(result.value.body);
      if (!json.ok) return err(json.error);
      return parseEdsmBodies(json.value);
    },
  };
}
