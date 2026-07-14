/**
 * Mining-session summary (SSOT Step 1.8). The rolled-up view the Command Deck
 * shows and 1.9 sends over IPC. Lives in `shared` (like the other domain types).
 * Rates are computed from elapsed wall-clock between session start and the last
 * mining signal.
 */

/**
 * Prospector statistics (SSOT Step 2.8) — rolled up from the session's prospect
 * observations + their Assay verdicts. Derived (recomputable from the persisted
 * prospects), streamed live on `session.stats`.
 */
export interface ProspectStats {
  /** Total prospects observed this session. */
  readonly prospected: number;
  /** How many earned a MINE verdict. */
  readonly mineVerdicts: number;
  /** mineVerdicts / prospected (0 when none prospected). */
  readonly hitRate: number;
  /** Mean best (highest-proportion) material %, over prospects that had materials. */
  readonly avgBestMaterialPct: number;
  /** Prospects that carried a motherlode. */
  readonly motherlodeCount: number;
  /** Count of prospects keyed by the canonical id of their dominant material. */
  readonly byCommodity: Readonly<Record<string, number>>;
}

export interface SessionSummary {
  readonly active: boolean;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly cmdr?: string;
  readonly ship?: string;
  readonly system?: string;
  readonly body?: string;
  readonly ring?: string;
  readonly tonsRefined: number;
  readonly tonsPerHour: number;
  readonly creditsEarned: number;
  readonly creditsPerHour: number;
  readonly limpetsLaunched: number;
  /**
   * Sells at a Fleet Carrier are banked, not income (excluded from creditsPerHour).
   * Phase-1 approximation: keys on station type, so it also excludes sells at other
   * commanders' carriers; true own-carrier matching by ID lands in Phase 8.
   */
  readonly bankedToCarrier: number;
  /** Prospector statistics (Step 2.8); absent until the enrichment path adds it. */
  readonly prospectStats?: ProspectStats;
}
