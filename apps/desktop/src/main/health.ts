/**
 * The app.health payload builder. Values come from real probes (not
 * constants); in Phase 0 the DB probe goes live in Step 0.6 and the journal
 * probe in Step 0.7. Kept pure so it is exhaustively unit-testable.
 */

import type { AppHealth } from "@lodestar/shared";

type ProbeStatus = AppHealth["dbStatus"];

export interface HealthProbes {
  readonly version: string;
  readonly db: () => ProbeStatus;
  readonly journal: () => ProbeStatus;
}

export function buildHealth(probes: HealthProbes): AppHealth {
  return {
    version: probes.version,
    dbStatus: probes.db(),
    journalStatus: probes.journal(),
  };
}
