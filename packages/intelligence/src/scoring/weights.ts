/**
 * Scoring weights (SSOT Step 4.5). The versioned default weight vector for the hotspot
 * score. PROVISIONAL, community-documented starting points carrying a provenance note —
 * Phase-6 Bayesian calibration OWNS updates (bumping `version`). Kept out of `score.ts`
 * so calibration touches data, not logic.
 */

export interface ScoringWeights {
  readonly version: number;
  /** Multiplier by reserve level (Pristine … Depleted). */
  readonly reserveWeights: Readonly<Record<string, number>>;
  /** Reserve weight when the level is unknown (neutral-ish, below Pristine). */
  readonly reserveUnknown: number;
  /** Canonical commodity id → the ring types it's community-documented to occur in. */
  readonly ringAffinity: Readonly<Record<string, readonly string[]>>;
  /** Ring-match factor when the ring type is in the commodity's affinity. */
  readonly ringMatchHit: number;
  /** …when the ring type is known but NOT in the affinity (poor match). */
  readonly ringMatchMiss: number;
  /** …when commodity affinity or ring type is unknown (neutral). */
  readonly ringMatchUnknown: number;
  /** Credits-equivalent score penalty per light-year from the commander. */
  readonly distancePenaltyPerLy: number;
  /** Credits-equivalent score penalty per light-second to the sell station. */
  readonly sellLegPenaltyPerLs: number;
  readonly note: string;
}

const METALLIC = "Metallic";
const METAL_RICH = "MetalRich";
const ICY = "Icy";
const ROCKY = "Rocky";

/**
 * Community-documented ring-type occurrence per commodity (provisional — a Phase-6
 * calibration target). Absent commodities fall back to the neutral ring-match weight.
 */
const RING_AFFINITY: Readonly<Record<string, readonly string[]>> = {
  platinum: [METALLIC, METAL_RICH],
  painite: [METALLIC, METAL_RICH],
  osmium: [METALLIC, METAL_RICH],
  palladium: [METALLIC, METAL_RICH],
  gold: [METALLIC, METAL_RICH],
  silver: [METALLIC],
  bertrandite: [METALLIC],
  indite: [METALLIC],
  gallite: [METALLIC],
  bromellite: [ICY],
  lowtemperaturediamond: [ICY],
  tritium: [ICY],
  opal: [ICY, ROCKY],
  alexandrite: [ICY, ROCKY],
  benitoite: [ROCKY, ICY],
  musgravite: [ROCKY],
  serendibite: [ROCKY],
  grandidierite: [ICY, ROCKY],
  monazite: [METALLIC, ROCKY],
  rhodplumsite: [METALLIC, ROCKY],
};

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  version: 1,
  reserveWeights: {
    Pristine: 1.0,
    Major: 0.8,
    Common: 0.6,
    Low: 0.4,
    Depleted: 0.2,
  },
  reserveUnknown: 0.6,
  ringAffinity: RING_AFFINITY,
  ringMatchHit: 1.0,
  ringMatchMiss: 0.4,
  ringMatchUnknown: 0.75,
  distancePenaltyPerLy: 500,
  sellLegPenaltyPerLs: 5,
  note: "provisional community-documented defaults; Phase-6 Bayesian calibration owns updates",
};
