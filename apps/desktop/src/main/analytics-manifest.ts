/**
 * Manifest data builder (SSOT Step 3.5, main-process). Assembles the full analytics
 * bundle the Manifest UI renders, from the `@lodestar/core` analytics repository +
 * the pure personal-bests fold. Returning the shared `ManifestData` type here
 * compile-enforces that the core result shapes match the shared IPC types (any drift
 * is a type error at this boundary).
 *
 * Personal bests are folded from the whole ended-session history for the board (the
 * persisted store drives the live `session.newBest` celebration, wired later);
 * single-rock value isn't persisted per prospect yet, so it's 0 for now (flagged).
 */

import type { Db } from "@lodestar/data";
import type { ManifestData, SessionDetail, SessionFilter } from "@lodestar/shared";
import { createAnalyticsRepository, foldPersonalBests, sessionBestValues } from "@lodestar/core";

const MANIFEST_SESSION_LIMIT = 300;

export function buildManifest(db: Db, filter: SessionFilter): ManifestData {
  const repo = createAnalyticsRepository(db);
  const bestInputs = repo.listSessions({}).map((s) => ({
    sessionId: s.id,
    ship: s.ship,
    ring: s.ring,
    achievedAt: s.endedAt ?? s.startedAt,
    values: sessionBestValues(s, 0),
  }));
  return {
    sessions: repo.listSessions({ ...filter, limit: filter.limit ?? MANIFEST_SESSION_LIMIT }),
    aggregate: repo.aggregate(filter),
    breakdowns: repo.breakdowns(filter),
    heatmaps: repo.heatmaps(filter),
    trend: repo.trend(filter),
    efficiency: repo.sessionEfficiency(filter),
    personalBests: foldPersonalBests(bestInputs),
  };
}

export function buildSessionDetail(db: Db, sessionId: number): SessionDetail | null {
  return createAnalyticsRepository(db).sessionDetail(sessionId) ?? null;
}

/** The empty bundle for when there is no database (unconfigured / open failed). */
export function emptyManifest(): ManifestData {
  const noTotals = {
    sessions: 0,
    prospectorLimpets: 0,
    collectionLimpets: 0,
    tonsRefined: 0,
    collectorProductivity: 0,
  };
  return {
    sessions: [],
    aggregate: {
      sessions: 0,
      tonsRefined: 0,
      creditsEarned: 0,
      limpetsLaunched: 0,
      totalDurationSec: 0,
      avgTonsPerHour: 0,
      avgCreditsPerHour: 0,
      prospected: 0,
      mineVerdicts: 0,
      hitRate: 0,
    },
    breakdowns: { byCommodity: [], byRing: [], byShip: [], bestPairings: [] },
    heatmaps: {
      timeProductivity: { rows: [], cols: [], cells: [] },
      ringCommodityYield: { rows: [], cols: [], cells: [] },
    },
    trend: [],
    efficiency: {
      limpets: { perSession: [], totals: noTotals },
      timeSplit: {
        perSession: [],
        totals: { sessions: 0, durationSec: 0, miningSec: 0, otherSec: 0, miningRatio: 0 },
      },
    },
    personalBests: [],
  };
}
