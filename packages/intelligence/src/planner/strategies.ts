/**
 * Run-plan strategies (SSOT Step 4.12, pure). Three ways to order candidate round-trip
 * plans: **Max Profit** (cr/hr), **Min Time** (total duration), **Safest** (highest
 * minimum route security, then fewest jumps). Pure comparators over the computed plan —
 * the planner NEVER controls the game; a plan is display/clipboard only.
 */

import type { RunPlan } from "./run-planner.js";

export type PlanStrategy = "max-profit" | "min-time" | "safest";

export const PLAN_STRATEGIES: readonly PlanStrategy[] = ["max-profit", "min-time", "safest"];

/** The comparator (a, b) < 0 ⇒ a ranks first for the given strategy. */
export function planComparator(strategy: PlanStrategy): (a: RunPlan, b: RunPlan) => number {
  switch (strategy) {
    case "max-profit":
      return (a, b) => b.estimatedCph - a.estimatedCph || a.totalTimeSec - b.totalTimeSec;
    case "min-time":
      return (a, b) => a.totalTimeSec - b.totalTimeSec || b.estimatedCph - a.estimatedCph;
    case "safest":
      return (a, b) =>
        b.candidate.minSecurity - a.candidate.minSecurity ||
        a.totalJumps - b.totalJumps ||
        b.estimatedCph - a.estimatedCph;
  }
}
