/**
 * Session-stats enrichment (SSOT Step 2.8). Decorates a `session.stats` payload
 * with live prospector statistics recomputed from the DISPLAYED session's persisted
 * prospects. Keyed on `engine.lastSessionId()` (not the active id), so the stats do
 * NOT zero out the instant a session ends — the review-your-haul moment.
 */

import { computeProspectStats, emptyProspectStats } from "@lodestar/core";
import type { ProspectRepository } from "@lodestar/core";
import type { SessionSummary } from "@lodestar/shared";

export function enrichSessionStats(
  session: SessionSummary | null,
  sessionId: number | undefined,
  prospects: ProspectRepository | undefined,
): SessionSummary | null {
  if (session === null) return null;
  const stats =
    prospects !== undefined && sessionId !== undefined
      ? computeProspectStats(prospects.listBySession(sessionId))
      : emptyProspectStats();
  return { ...session, prospectStats: stats };
}
