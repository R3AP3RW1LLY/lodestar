/**
 * Analytics value types + the PURE derivations over them (SSOT Step 3.1). The
 * repository (repository.ts) does the SQL and hands raw rows here; everything
 * derived — durations, per-hour rates, cross-session folds, the filter WHERE
 * clause — lives here so it is unit-testable against hand-computed goldens without
 * a database. Only the user's OWN accumulated data is ever queried (local profile).
 */

/** Filter for the session history/aggregates. All fields optional (AND-combined). */
export interface SessionFilter {
  /** started_at lower bound (ISO, inclusive). */
  readonly from?: string;
  /** started_at upper bound (ISO, inclusive). */
  readonly to?: string;
  readonly system?: string;
  readonly ring?: string;
  /** Sessions that refined this canonical commodity (Step 2.2 id). */
  readonly commodity?: string;
  /** Cap the number of rows (default: all). */
  readonly limit?: number;
}

/** One session in the history list, with derived duration + rates + prospect counts. */
export interface SessionListItem {
  readonly id: number;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly ship: string | null;
  readonly system: string | null;
  readonly ring: string | null;
  readonly tonsRefined: number;
  readonly creditsEarned: number;
  readonly limpetsLaunched: number;
  readonly durationSec: number;
  readonly tonsPerHour: number;
  readonly creditsPerHour: number;
  readonly prospected: number;
  readonly mineVerdicts: number;
}

/** Cross-session totals + averages over a filtered set. */
export interface SessionAggregates {
  readonly sessions: number;
  readonly tonsRefined: number;
  readonly creditsEarned: number;
  readonly limpetsLaunched: number;
  readonly totalDurationSec: number;
  readonly avgTonsPerHour: number;
  readonly avgCreditsPerHour: number;
  readonly prospected: number;
  readonly mineVerdicts: number;
  readonly hitRate: number;
}

export interface CommodityTons {
  readonly commodity: string;
  readonly tons: number;
}

/** A session drill-down: the summary row + per-commodity refined tons + prospect summary. */
export interface SessionDetail {
  readonly session: SessionListItem;
  readonly refinements: readonly CommodityTons[];
  readonly prospected: number;
  readonly mineVerdicts: number;
  readonly actedOn: number;
  readonly motherlodes: number;
}

/** One point of a productivity trend, chronological. */
export interface TrendPoint {
  readonly sessionId: number;
  readonly startedAt: string;
  readonly tonsRefined: number;
  readonly tonsPerHour: number;
  readonly creditsPerHour: number;
}

/** The raw session row (+ joined counts) the repository selects; mapped to a list item. */
export interface RawSessionRow {
  readonly id: number;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly ship: string | null;
  readonly system: string | null;
  readonly ring: string | null;
  readonly tons_refined: number;
  readonly credits_earned: number;
  readonly limpets_launched: number;
  readonly prospected: number;
  readonly mine_verdicts: number;
}

/** Seconds between two ISO timestamps, clamped ≥ 0; 0 when the session hasn't ended. */
export function durationSec(startedAt: string, endedAt: string | null): number {
  if (endedAt === null) return 0;
  const ms = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 1000) : 0;
}

/** A per-hour rate, or 0 when no time has elapsed (never divides by zero). */
export function perHour(total: number, seconds: number): number {
  return seconds > 0 ? (total * 3600) / seconds : 0;
}

/** Map a raw session row to a list item, deriving duration + rates. */
export function toSessionListItem(row: RawSessionRow): SessionListItem {
  const dur = durationSec(row.started_at, row.ended_at);
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    ship: row.ship,
    system: row.system,
    ring: row.ring,
    tonsRefined: row.tons_refined,
    creditsEarned: row.credits_earned,
    limpetsLaunched: row.limpets_launched,
    durationSec: dur,
    tonsPerHour: perHour(row.tons_refined, dur),
    creditsPerHour: perHour(row.credits_earned, dur),
    prospected: row.prospected,
    mineVerdicts: row.mine_verdicts,
  };
}

/** A trend point from a list item (identity map of the charted fields). */
export function toTrendPoint(item: SessionListItem): TrendPoint {
  return {
    sessionId: item.id,
    startedAt: item.startedAt,
    tonsRefined: item.tonsRefined,
    tonsPerHour: item.tonsPerHour,
    creditsPerHour: item.creditsPerHour,
  };
}

/**
 * Fold the filtered session list into cross-session aggregates. Rate averages use
 * only sessions with elapsed time (total tons ÷ total mining hours), so a
 * zero-duration row never dilutes tons/hr — but its tons/credits still count in the
 * totals. Hit rate = MINE verdicts ÷ prospects observed.
 */
export function computeAggregates(items: readonly SessionListItem[]): SessionAggregates {
  let tonsRefined = 0;
  let creditsEarned = 0;
  let limpetsLaunched = 0;
  let totalDurationSec = 0;
  let prospected = 0;
  let mineVerdicts = 0;
  let ratedTons = 0;
  let ratedCredits = 0;
  let ratedSeconds = 0;
  for (const s of items) {
    tonsRefined += s.tonsRefined;
    creditsEarned += s.creditsEarned;
    limpetsLaunched += s.limpetsLaunched;
    totalDurationSec += s.durationSec;
    prospected += s.prospected;
    mineVerdicts += s.mineVerdicts;
    if (s.durationSec > 0) {
      ratedTons += s.tonsRefined;
      ratedCredits += s.creditsEarned;
      ratedSeconds += s.durationSec;
    }
  }
  return {
    sessions: items.length,
    tonsRefined,
    creditsEarned,
    limpetsLaunched,
    totalDurationSec,
    avgTonsPerHour: perHour(ratedTons, ratedSeconds),
    avgCreditsPerHour: perHour(ratedCredits, ratedSeconds),
    prospected,
    mineVerdicts,
    hitRate: prospected > 0 ? mineVerdicts / prospected : 0,
  };
}

export interface WhereClause {
  readonly sql: string;
  readonly params: Record<string, unknown>;
}

/**
 * Build the WHERE clause for the session history from a filter. Always scoped to
 * ENDED sessions (an in-progress session has no final totals/duration). The
 * commodity filter is a correlated EXISTS so the large `refinements` table is
 * reached through `idx_refinements_session`, never scanned.
 */
export function buildSessionWhere(filter: SessionFilter): WhereClause {
  const clauses: string[] = ["s.status = 'ended'"];
  const params: Record<string, unknown> = {};
  if (filter.from !== undefined) {
    clauses.push("s.started_at >= @from");
    params["from"] = filter.from;
  }
  if (filter.to !== undefined) {
    clauses.push("s.started_at <= @to");
    params["to"] = filter.to;
  }
  if (filter.system !== undefined) {
    clauses.push("s.system = @system");
    params["system"] = filter.system;
  }
  if (filter.ring !== undefined) {
    clauses.push("s.ring = @ring");
    params["ring"] = filter.ring;
  }
  if (filter.commodity !== undefined) {
    clauses.push(
      "EXISTS (SELECT 1 FROM refinements r WHERE r.session_id = s.id AND r.commodity = @commodity)",
    );
    params["commodity"] = filter.commodity;
  }
  return { sql: clauses.join(" AND "), params };
}
