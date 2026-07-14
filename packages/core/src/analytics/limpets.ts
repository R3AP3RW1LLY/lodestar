/**
 * Limpet efficiency (SSOT Step 3.7) — PURE fold over a session's LaunchDrone events.
 *
 * DEFINITION OF RECORD (journals emit NO per-fragment collection events, so we never
 * fabricate a "collected" count): prospector spend = prospector limpets LAUNCHED;
 * collector productivity = tons refined ÷ collection limpets LAUNCHED. Both are
 * labelled exactly so — the only honest measures the journal supports.
 *
 * Reconciliation: prospector + collection + other launches == the session's stored
 * `limpets_launched` total (every LaunchDrone increments it), asserted in tests.
 */

export interface LimpetEventInput {
  readonly eventType: string;
  /** The logged event payload JSON (LaunchDrone carries `{ droneType }`). */
  readonly payload: string;
}

export interface SessionLimpetEfficiency {
  readonly prospectorLimpets: number;
  readonly collectionLimpets: number;
  /** LaunchDrone with a non-prospector/collection (or unparseable) drone type. */
  readonly otherLimpets: number;
  readonly tonsRefined: number;
  /** Tons refined per collection limpet launched (0 when none were launched). */
  readonly collectorProductivity: number;
}

function droneTypeOf(payload: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(payload);
    const dt = (parsed as { droneType?: unknown }).droneType;
    return typeof dt === "string" ? dt : undefined;
  } catch {
    return undefined;
  }
}

export function sessionLimpets(
  events: readonly LimpetEventInput[],
  tonsRefined: number,
): SessionLimpetEfficiency {
  let prospector = 0;
  let collection = 0;
  let other = 0;
  for (const e of events) {
    if (e.eventType !== "LaunchDrone") continue;
    const droneType = droneTypeOf(e.payload);
    if (droneType === "Prospector") prospector += 1;
    else if (droneType === "Collection") collection += 1;
    else other += 1;
  }
  return {
    prospectorLimpets: prospector,
    collectionLimpets: collection,
    otherLimpets: other,
    tonsRefined,
    collectorProductivity: collection > 0 ? tonsRefined / collection : 0,
  };
}

export interface LimpetTotals {
  readonly sessions: number;
  readonly prospectorLimpets: number;
  readonly collectionLimpets: number;
  readonly tonsRefined: number;
  readonly collectorProductivity: number;
}

/** Aggregate per-session limpet efficiency into a total (productivity over the pooled totals). */
export function aggregateLimpets(perSession: readonly SessionLimpetEfficiency[]): LimpetTotals {
  let prospector = 0;
  let collection = 0;
  let tons = 0;
  for (const s of perSession) {
    prospector += s.prospectorLimpets;
    collection += s.collectionLimpets;
    tons += s.tonsRefined;
  }
  return {
    sessions: perSession.length,
    prospectorLimpets: prospector,
    collectionLimpets: collection,
    tonsRefined: tons,
    collectorProductivity: collection > 0 ? tons / collection : 0,
  };
}
