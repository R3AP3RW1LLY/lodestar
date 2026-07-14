/**
 * Prospector statistics (SSOT Step 2.8). A PURE fold over a session's prospect
 * observations (+ their Assay verdicts) into rolling stats: hit rate (MINE ÷
 * prospected), average best-material %, per-commodity distribution (keyed by the
 * canonical dominant material, Step 2.2), and motherlode count. Derived — the
 * persisted prospects are the source of truth, so the stats are always
 * recomputable and never need their own migration. Recomputed live per session
 * and streamed on `session.stats` (2.8 wiring).
 */

import { commodityFromInternal } from "@lodestar/shared";
import type { ProspectStats } from "@lodestar/shared";

/** The minimal per-prospect shape the stats need (a `StoredProspect` satisfies it). */
export interface ProspectStatEntry {
  readonly materials: readonly { readonly name: string; readonly proportion: number }[];
  readonly motherlode?: string;
  readonly verdict: "MINE" | "SKIP" | undefined;
}

export function emptyProspectStats(): ProspectStats {
  return {
    prospected: 0,
    mineVerdicts: 0,
    hitRate: 0,
    avgBestMaterialPct: 0,
    motherlodeCount: 0,
    byCommodity: {},
  };
}

/** The dominant material (highest proportion) of a prospect, or undefined for an empty rock. */
function dominant(
  materials: ProspectStatEntry["materials"],
): { readonly name: string; readonly proportion: number } | undefined {
  let best: { readonly name: string; readonly proportion: number } | undefined;
  for (const m of materials) {
    if (best === undefined || m.proportion > best.proportion) best = m;
  }
  return best;
}

export function computeProspectStats(entries: readonly ProspectStatEntry[]): ProspectStats {
  if (entries.length === 0) return emptyProspectStats();

  let mineVerdicts = 0;
  let motherlodeCount = 0;
  let bestPctSum = 0;
  let withMaterials = 0;
  const byCommodity: Record<string, number> = {};

  for (const entry of entries) {
    if (entry.verdict === "MINE") mineVerdicts += 1;
    if (entry.motherlode !== undefined) motherlodeCount += 1;
    const best = dominant(entry.materials);
    if (best !== undefined) {
      withMaterials += 1;
      bestPctSum += best.proportion;
      const resolved = commodityFromInternal(best.name);
      const id = resolved.ok ? resolved.commodity.id : best.name.trim().toLowerCase();
      byCommodity[id] = (byCommodity[id] ?? 0) + 1;
    }
  }

  const prospected = entries.length;
  return {
    prospected,
    mineVerdicts,
    hitRate: mineVerdicts / prospected,
    // Averaged over prospects that HAD materials — a material-less rock never dilutes it.
    avgBestMaterialPct: withMaterials > 0 ? bestPctSum / withMaterials : 0,
    motherlodeCount,
    byCommodity,
  };
}
