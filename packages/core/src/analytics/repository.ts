/**
 * Analytics repository (SSOT Step 3.1) — read-only historical queries over the
 * user's OWN sessions / refinements / prospects (local profile). All derived math
 * lives in the pure aggregates.ts; this module is the SQL + row mapping.
 *
 * Index discipline (acceptance: hot queries' EXPLAIN QUERY PLAN uses an index):
 * every access to the LARGE child tables (`refinements`, `prospects`) goes through
 * `session_id` (idx_refinements_session / idx_prospects_session) — the prospect
 * counts as correlated subqueries, the commodity filter as a correlated EXISTS, and
 * the detail breakdowns as `WHERE session_id = ?`. The small `sessions` root table
 * is walked in PRIMARY-KEY order (`ORDER BY s.id DESC` = recency, since ids are
 * assigned in start order), so there is no full scan of a large table anywhere.
 */

import type { Db } from "@lodestar/data";
import type {
  CommodityTons,
  RawSessionRow,
  SessionAggregates,
  SessionDetail,
  SessionFilter,
  SessionListItem,
  TrendPoint,
} from "./aggregates.js";
import {
  buildSessionWhere,
  computeAggregates,
  toSessionListItem,
  toTrendPoint,
} from "./aggregates.js";
import { assembleBreakdowns } from "./breakdowns.js";
import type { Breakdowns, SessionBreakdownInput } from "./breakdowns.js";
import { ringCommodityHeatmap, timeProductivityHeatmap } from "./heatmaps.js";
import type { Heatmaps, YieldInput } from "./heatmaps.js";
import { aggregateLimpets, sessionLimpets } from "./limpets.js";
import type { LimpetTotals, SessionLimpetEfficiency } from "./limpets.js";
import { aggregateTimeSplit, sessionTimeSplit } from "./time-split.js";
import type { SessionTimeSplit, TimeSplitTotals } from "./time-split.js";

/** A session's logged events (seeks `session_events` via its index). */
export const SESSION_EVENTS_SQL =
  "SELECT event_type AS eventType, payload, timestamp FROM session_events WHERE session_id = @id ORDER BY seq";

interface SessionEventRow {
  readonly eventType: string;
  readonly payload: string;
  readonly timestamp: string;
}

/** Per-session limpet efficiency + mining/other time split, with pooled totals. */
export interface SessionEfficiency {
  readonly limpets: {
    readonly perSession: readonly ({ readonly sessionId: number } & SessionLimpetEfficiency)[];
    readonly totals: LimpetTotals;
  };
  readonly timeSplit: {
    readonly perSession: readonly ({ readonly sessionId: number } & SessionTimeSplit)[];
    readonly totals: TimeSplitTotals;
  };
}

const PROSPECTED_SUB = "(SELECT COUNT(*) FROM prospects p WHERE p.session_id = s.id)";
const MINE_SUB =
  "(SELECT COUNT(*) FROM prospects p WHERE p.session_id = s.id AND p.verdict = 'MINE')";

/** The session-list SELECT for a given WHERE clause (exported so EXPLAIN tests can plan it). */
export function listSessionsSql(where: string): string {
  return `SELECT s.id, s.started_at, s.ended_at, s.ship, s.system, s.ring,
       s.tons_refined, s.credits_earned, s.limpets_launched,
       ${PROSPECTED_SUB} AS prospected, ${MINE_SUB} AS mine_verdicts
     FROM sessions s
     WHERE ${where}
     ORDER BY s.id DESC
     LIMIT @limit`;
}

/** Per-session refined tons grouped by commodity (seeks `refinements` via its index). */
export const REFINEMENTS_BY_COMMODITY_SQL =
  "SELECT commodity, SUM(tons) AS tons FROM refinements WHERE session_id = @id GROUP BY commodity ORDER BY tons DESC, commodity";

/** Ring × commodity refined-tons yield for a WHERE clause; reaches `refinements` via its index. */
export function HEATMAP_YIELD_SQL(where: string): string {
  return `SELECT s.ring AS ring, r.commodity AS commodity, SUM(r.tons) AS tons
     FROM sessions s JOIN refinements r ON r.session_id = s.id
     WHERE ${where}
     GROUP BY s.ring, r.commodity`;
}

/** A session's dominant (highest-tonnage) commodity (seeks `refinements` via its index). */
export const DOMINANT_COMMODITY_SQL =
  "SELECT commodity FROM refinements WHERE session_id = @id GROUP BY commodity ORDER BY SUM(tons) DESC, commodity LIMIT 1";

/** Per-session prospect summary (seeks `prospects` via its index). */
export const PROSPECT_SUMMARY_SQL = `SELECT COUNT(*) AS prospected,
     SUM(CASE WHEN verdict = 'MINE' THEN 1 ELSE 0 END) AS mine_verdicts,
     SUM(acted_on) AS acted_on,
     COUNT(motherlode) AS motherlodes
   FROM prospects WHERE session_id = @id`;

interface RefinementRow {
  readonly commodity: string;
  readonly tons: number;
}
interface ProspectSummaryRow {
  readonly prospected: number;
  readonly mine_verdicts: number | null;
  readonly acted_on: number | null;
  readonly motherlodes: number;
}

export interface AnalyticsRepository {
  /** Ended sessions matching the filter, newest first (with derived rates + prospect counts). */
  listSessions: (filter?: SessionFilter) => SessionListItem[];
  /** Drill-down for one session (any status): summary + commodity breakdown + prospect summary. */
  sessionDetail: (id: number) => SessionDetail | undefined;
  /** Cross-session totals + averages over the filtered set. */
  aggregate: (filter?: SessionFilter) => SessionAggregates;
  /** Chronological (oldest→newest) productivity trend of the filtered sessions. */
  trend: (filter?: SessionFilter) => TrendPoint[];
  /** Per-commodity / ring / ship breakdowns + best (ring × commodity) pairings. */
  breakdowns: (filter?: SessionFilter) => Breakdowns;
  /** Time-productivity (day×hour) + ring×commodity yield heatmaps. */
  heatmaps: (filter?: SessionFilter) => Heatmaps;
  /** Per-session limpet efficiency + mining/other time split + totals (Step 3.7). */
  sessionEfficiency: (filter?: SessionFilter) => SessionEfficiency;
}

export function createAnalyticsRepository(db: Db): AnalyticsRepository {
  const list = (filter: SessionFilter): SessionListItem[] => {
    const where = buildSessionWhere(filter);
    const rows = db
      .prepare(listSessionsSql(where.sql))
      .all({ ...where.params, limit: filter.limit ?? -1 }) as RawSessionRow[];
    return rows.map(toSessionListItem);
  };

  const detailRow = (id: number): SessionListItem | undefined => {
    // No status filter — the drill-down works for the active session too.
    const row = db.prepare(listSessionsSql("s.id = @id")).get({ id, limit: -1 }) as
      RawSessionRow | undefined;
    return row === undefined ? undefined : toSessionListItem(row);
  };

  const dominantStmt = db.prepare(DOMINANT_COMMODITY_SQL);

  return {
    listSessions: (filter = {}) => list(filter),
    aggregate: (filter = {}) => computeAggregates(list(filter)),
    // list() returns a fresh array, so reversing it in place is safe.
    trend: (filter = {}) => list(filter).reverse().map(toTrendPoint),
    breakdowns: (filter = {}) => {
      const inputs = list(filter).map((s): SessionBreakdownInput => {
        const dom = dominantStmt.get({ id: s.id }) as { commodity: string } | undefined;
        return {
          ring: s.ring,
          ship: s.ship,
          commodity: dom?.commodity ?? null,
          tonsRefined: s.tonsRefined,
          creditsEarned: s.creditsEarned,
          durationSec: s.durationSec,
        };
      });
      return assembleBreakdowns(inputs);
    },
    heatmaps: (filter = {}) => {
      const sessions = list(filter);
      const yields = db
        .prepare(HEATMAP_YIELD_SQL(buildSessionWhere(filter).sql))
        .all(buildSessionWhere(filter).params) as YieldInput[];
      return {
        timeProductivity: timeProductivityHeatmap(
          sessions.map((s) => ({
            startedAt: s.startedAt,
            tonsRefined: s.tonsRefined,
            durationSec: s.durationSec,
          })),
        ),
        ringCommodityYield: ringCommodityHeatmap(yields),
      };
    },
    sessionEfficiency: (filter = {}) => {
      const eventsStmt = db.prepare(SESSION_EVENTS_SQL);
      const limpetRows: ({ sessionId: number } & SessionLimpetEfficiency)[] = [];
      const splitRows: ({ sessionId: number } & SessionTimeSplit)[] = [];
      for (const s of list(filter)) {
        const events = eventsStmt.all({ id: s.id }) as SessionEventRow[];
        limpetRows.push({ sessionId: s.id, ...sessionLimpets(events, s.tonsRefined) });
        splitRows.push({ sessionId: s.id, ...sessionTimeSplit(events, s.startedAt, s.endedAt) });
      }
      return {
        limpets: { perSession: limpetRows, totals: aggregateLimpets(limpetRows) },
        timeSplit: { perSession: splitRows, totals: aggregateTimeSplit(splitRows) },
      };
    },
    sessionDetail: (id) => {
      const session = detailRow(id);
      if (session === undefined) return undefined;
      const refinements = db.prepare(REFINEMENTS_BY_COMMODITY_SQL).all({ id }) as RefinementRow[];
      const p = db.prepare(PROSPECT_SUMMARY_SQL).get({ id }) as ProspectSummaryRow;
      return {
        session,
        refinements: refinements.map((r): CommodityTons => ({
          commodity: r.commodity,
          tons: r.tons,
        })),
        prospected: p.prospected,
        mineVerdicts: p.mine_verdicts ?? 0,
        actedOn: p.acted_on ?? 0,
        motherlodes: p.motherlodes,
      };
    },
  };
}
