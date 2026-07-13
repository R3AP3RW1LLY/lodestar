/**
 * MINE/SKIP verdict engine (SSOT Step 2.4). A PURE function of a prospect
 * observation + the resolved thresholds + a price book + the current mining
 * method. Reasons are STRUCTURED (not prose) so the UI and TTS render them
 * verbatim. Value/t is computed against best-known prices via canonical ids
 * (Step 2.2). Precedence is explicit and pinned by tests:
 *   depleted (Remaining = 0) → SKIP  BEATS  motherlode → MINE.
 * Everything else: any material at/above its commodity×method threshold → MINE,
 * otherwise SKIP.
 */

import { commodityFromInternal } from "@lodestar/shared";
import type { MiningMethod } from "@lodestar/shared";

/** The minimal prospect shape the verdict needs (a core `Prospect` satisfies it). */
export interface ProspectInput {
  readonly materials: readonly { readonly name: string; readonly proportion: number }[];
  readonly content: string;
  readonly remainingPct: number;
  readonly motherlode?: string;
}

/** Resolved worth-mining threshold (%) for a commodity+method, or undefined. */
export type ThresholdResolver = (commodityId: string, method: MiningMethod) => number | undefined;

/** Best-known sell price per ton for a commodity, or undefined if unknown. */
export type PriceBook = (commodityId: string) => number | undefined;

export type ContentTier = "High" | "Medium" | "Low" | "Unknown";

export type Reason =
  | { readonly code: "motherlode"; readonly commodityId: string; readonly display: string }
  | { readonly code: "already-depleted"; readonly remainingPct: number }
  | {
      readonly code: "proportion-above-threshold";
      readonly commodityId: string;
      readonly display: string;
      readonly proportion: number;
      readonly threshold: number;
    }
  | { readonly code: "price-weighted-value/t"; readonly valuePerTon: number }
  | { readonly code: "content-tier"; readonly tier: ContentTier };

export interface Verdict {
  readonly call: "MINE" | "SKIP";
  /** Price-weighted expected value per ton of rock — higher is better (ranking). */
  readonly score: number;
  readonly reasons: readonly Reason[];
}

export function contentTier(content: string): ContentTier {
  const c = content.toLowerCase();
  if (c.includes("high")) return "High";
  if (c.includes("medium")) return "Medium";
  if (c.includes("low")) return "Low";
  return "Unknown";
}

interface ResolvedMaterial {
  readonly commodityId: string | undefined;
  readonly display: string;
  readonly proportion: number;
  readonly contribution: number; // price × proportion/100
}

export function assay(
  prospect: ProspectInput,
  method: MiningMethod,
  thresholds: ThresholdResolver,
  priceBook: PriceBook,
): Verdict {
  const resolved: ResolvedMaterial[] = prospect.materials.map((m) => {
    const r = commodityFromInternal(m.name);
    const commodityId = r.ok ? r.commodity.id : undefined;
    const price = commodityId !== undefined ? (priceBook(commodityId) ?? 0) : 0;
    return {
      commodityId,
      display: r.ok ? r.commodity.displayName : m.name,
      proportion: m.proportion,
      contribution: (price * m.proportion) / 100,
    };
  });
  const score = resolved.reduce((sum, x) => sum + x.contribution, 0);

  // Supporting reasons every verdict carries (rendered after the primary reason).
  const support: Reason[] = [
    { code: "price-weighted-value/t", valuePerTon: score },
    { code: "content-tier", tier: contentTier(prospect.content) },
  ];

  // (1) Depleted beats everything — a rock with nothing left is never worth mining.
  if (prospect.remainingPct <= 0) {
    return {
      call: "SKIP",
      score,
      reasons: [{ code: "already-depleted", remainingPct: prospect.remainingPct }, ...support],
    };
  }

  // (2) Motherlode → always MINE (deep-core payload).
  if (prospect.motherlode !== undefined) {
    const r = commodityFromInternal(prospect.motherlode);
    return {
      call: "MINE",
      score,
      reasons: [
        {
          code: "motherlode",
          commodityId: r.ok ? r.commodity.id : prospect.motherlode,
          display: r.ok ? r.commodity.displayName : prospect.motherlode,
        },
        ...support,
      ],
    };
  }

  // (3) Any material at/above its commodity×method threshold → MINE.
  const qualifying: {
    readonly commodityId: string;
    readonly display: string;
    readonly proportion: number;
    readonly threshold: number;
    readonly contribution: number;
  }[] = [];
  for (const x of resolved) {
    if (x.commodityId === undefined) continue;
    const threshold = thresholds(x.commodityId, method);
    if (threshold !== undefined && x.proportion >= threshold) {
      qualifying.push({
        commodityId: x.commodityId,
        display: x.display,
        proportion: x.proportion,
        threshold,
        contribution: x.contribution,
      });
    }
  }
  if (qualifying.length > 0) {
    // Lead with the DOMINANT-VALUE qualifier (price-weighted contribution), so the
    // UI/TTS speak the economically-best commodity first. Proportion breaks ties
    // (incl. the no-price-data case where every contribution is 0).
    qualifying.sort((a, b) => b.contribution - a.contribution || b.proportion - a.proportion);
    const reasons: Reason[] = qualifying.map((q) => ({
      code: "proportion-above-threshold",
      commodityId: q.commodityId,
      display: q.display,
      proportion: q.proportion,
      threshold: q.threshold,
    }));
    return { call: "MINE", score, reasons: [...reasons, ...support] };
  }

  return { call: "SKIP", score, reasons: support };
}
