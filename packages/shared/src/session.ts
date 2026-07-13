/**
 * Mining-session summary (SSOT Step 1.8). The rolled-up view the Command Deck
 * shows and 1.9 sends over IPC. Lives in `shared` (like the other domain types).
 * Rates are computed from elapsed wall-clock between session start and the last
 * mining signal.
 */

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
}
