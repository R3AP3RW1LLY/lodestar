/**
 * Vein Finder IPC DTOs (SSOT Step 4.13). The scored hotspot candidates + filters that
 * cross IPC to the Vein Finder screen. `breakdown` mirrors the Step-4.5 score terms
 * exactly so the UI can explain "why this score". Overlap honesty (4.4): `candidate` =
 * "possible — verify in ring", `confirmed` = the commander saw it.
 */

export type VeinOverlapState = "none" | "candidate" | "confirmed";

/** Mirrors the Step-4.5 `ScoreBreakdown` term-for-term. */
export interface VeinScoreBreakdown {
  readonly price: number;
  readonly overlapMultiplier: number;
  readonly reserveWeight: number;
  readonly ringMatch: number;
  readonly base: number;
  readonly distancePenalty: number;
  readonly sellLegPenalty: number;
  readonly score: number;
}

export interface VeinCandidate {
  readonly ringName: string;
  readonly commodityId: string;
  readonly systemName: string;
  readonly ringType: string | null;
  readonly reserve: string | null;
  readonly padSize: string | null;
  readonly hotspotCount: number;
  /** Best sell (from the Ledger); 0 when no market data is known yet. */
  readonly sellPrice: number;
  readonly sellStation: string | null;
  readonly sellSystem: string | null;
  /** Distance from the commander (ly); null when the location is unknown. */
  readonly distanceLy: number | null;
  readonly overlap: VeinOverlapState;
  readonly overlapCommodities: readonly string[];
  readonly breakdown: VeinScoreBreakdown;
  readonly score: number;
  /** Hotspot provenance: seed | journal | community. */
  readonly source: string;
  /** Last-confirmed time (ms epoch) for the data-age badge. */
  readonly updatedAtMs: number;
}

export interface VeinFilter {
  readonly commodityId?: string;
  readonly maxDistanceLy?: number;
  readonly reserve?: string;
  readonly ringType?: string;
  readonly minPad?: "S" | "M" | "L";
  readonly maxSellLegLs?: number;
}
