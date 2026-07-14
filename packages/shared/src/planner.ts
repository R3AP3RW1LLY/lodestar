/**
 * Cartographer / run-plan IPC DTOs (SSOT Step 4.12c). The plan shapes that cross IPC
 * between the main-process plan service and the renderer. Structurally mirror the
 * `intelligence` planner result; the main handler maps to these. A plan is DATA the player
 * copies into the galaxy map by hand — never injected into the game.
 */

export type PlanStrategy = "max-profit" | "min-time" | "safest";

export interface PlanLeg {
  readonly from: string;
  readonly to: string;
  readonly distanceLy: number;
  readonly jumps: number;
}

export interface PlanCandidate {
  readonly ringName: string;
  readonly commodityId: string;
  readonly systemName: string;
  readonly miningTph: number;
  readonly sellStation: string;
  readonly sellSystem: string;
  readonly sellPrice: number;
  readonly outboundLegs: readonly PlanLeg[];
  readonly returnLegs: readonly PlanLeg[];
  readonly minSecurity: number;
}

export interface RunPlanView {
  readonly candidate: PlanCandidate;
  readonly fillTimeSec: number;
  readonly travelTimeSec: number;
  readonly totalTimeSec: number;
  readonly totalJumps: number;
  readonly cargoValue: number;
  readonly estimatedTph: number;
  readonly estimatedCph: number;
}

export interface PlanRunsRequest {
  readonly strategy: PlanStrategy;
}

export interface SavePlanRequest {
  /** Index into the last planned list to persist (avoids round-tripping the whole plan). */
  readonly index: number;
}

export interface SavePlanResult {
  readonly runId: number | null;
}
