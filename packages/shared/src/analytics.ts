/**
 * Analytics DATA types (SSOT Phase 3). These live in `shared` — not `core` — because
 * they cross the IPC boundary to the Manifest UI (the channel payloads reference
 * them), and `shared` is the only package both `core` (which computes them) and the
 * renderer (which displays them) may depend on. `core/analytics` imports these and
 * owns the pure functions + SQL that produce them; the derived-math rationale lives
 * there.
 */

/** Filter for the session history/aggregates. All fields optional (AND-combined). */
export interface SessionFilter {
  readonly from?: string;
  readonly to?: string;
  readonly system?: string;
  readonly ring?: string;
  readonly commodity?: string;
  readonly limit?: number;
}

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

export interface SessionDetail {
  readonly session: SessionListItem;
  readonly refinements: readonly CommodityTons[];
  readonly prospected: number;
  readonly mineVerdicts: number;
  readonly actedOn: number;
  readonly motherlodes: number;
}

export interface TrendPoint {
  readonly sessionId: number;
  readonly startedAt: string;
  readonly tonsRefined: number;
  readonly tonsPerHour: number;
  readonly creditsPerHour: number;
}

export interface BreakdownRow {
  readonly key: string;
  readonly sessions: number;
  readonly tonsRefined: number;
  readonly creditsEarned: number;
  readonly durationSec: number;
  readonly tonsPerHour: number;
  readonly creditsPerHour: number;
}

export interface PairingRow {
  readonly ring: string;
  readonly commodity: string;
  readonly sessions: number;
  readonly tonsRefined: number;
  readonly durationSec: number;
  readonly tonsPerHour: number;
  readonly creditsPerHour: number;
}

export interface Breakdowns {
  readonly byCommodity: readonly BreakdownRow[];
  readonly byRing: readonly BreakdownRow[];
  readonly byShip: readonly BreakdownRow[];
  readonly bestPairings: readonly PairingRow[];
}

/** A `{rows, cols, cells}` matrix; `cells[r][c]` is a value (may be 0) or null (no data). */
export interface Heatmap {
  readonly rows: readonly string[];
  readonly cols: readonly string[];
  readonly cells: readonly (readonly (number | null)[])[];
}

export interface Heatmaps {
  readonly timeProductivity: Heatmap;
  readonly ringCommodityYield: Heatmap;
}

export type BestCategory =
  "tons_per_hour" | "credits_per_hour" | "single_rock_value" | "longest_session" | "most_tons";

export interface PersonalBest {
  readonly category: BestCategory;
  readonly value: number;
  readonly sessionId: number | null;
  readonly ship: string | null;
  readonly ring: string | null;
  readonly achievedAt: string;
}

export interface SessionLimpetEfficiency {
  readonly prospectorLimpets: number;
  readonly collectionLimpets: number;
  readonly otherLimpets: number;
  readonly tonsRefined: number;
  readonly collectorProductivity: number;
}

export interface LimpetTotals {
  readonly sessions: number;
  readonly prospectorLimpets: number;
  readonly collectionLimpets: number;
  readonly tonsRefined: number;
  readonly collectorProductivity: number;
}

export interface SessionTimeSplit {
  readonly durationSec: number;
  readonly miningSec: number;
  readonly otherSec: number;
  readonly miningRatio: number;
}

export interface TimeSplitTotals {
  readonly sessions: number;
  readonly durationSec: number;
  readonly miningSec: number;
  readonly otherSec: number;
  readonly miningRatio: number;
}

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

/** The full Manifest bundle sent to the renderer for a filter (Step 3.5). */
export interface ManifestData {
  readonly sessions: readonly SessionListItem[];
  readonly aggregate: SessionAggregates;
  readonly breakdowns: Breakdowns;
  readonly heatmaps: Heatmaps;
  readonly trend: readonly TrendPoint[];
  readonly efficiency: SessionEfficiency;
  readonly personalBests: readonly PersonalBest[];
}
