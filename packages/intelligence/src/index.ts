export type { ThresholdEntry, ThresholdOverrideInput } from "./assay/thresholds.js";
export {
  DEFAULT_THRESHOLDS,
  MOTHERLODE_ALWAYS_MINE,
  defaultThreshold,
  mergeThresholds,
} from "./assay/thresholds.js";
export type {
  Verdict,
  Reason,
  ContentTier,
  ProspectInput,
  ThresholdResolver,
  PriceBook,
} from "./assay/verdict.js";
export { assay, contentTier } from "./assay/verdict.js";
export type {
  OverlapConfidence,
  HotspotObservation,
  RingOverlap,
  OverlapWeights,
} from "./hotspots/overlaps.js";
export {
  DEFAULT_OVERLAP_WEIGHTS,
  detectOverlapCandidate,
  confirmOverlap,
  overlapMultiplier,
} from "./hotspots/overlaps.js";
export type { ScoreInput, ScoreBreakdown } from "./scoring/score.js";
export { scoreRing } from "./scoring/score.js";
export type { ScoringWeights } from "./scoring/weights.js";
export { DEFAULT_SCORING_WEIGHTS } from "./scoring/weights.js";
export type {
  SellSnapshot,
  PadSize,
  SellFilter,
  SellWeights,
  RankedStation,
} from "./ledger/best-sell.js";
export { DEFAULT_SELL_WEIGHTS, freshnessWeight, rankSellStations } from "./ledger/best-sell.js";
export type { TrendPoint as LedgerTrendPoint } from "./ledger/trends.js";
export { priceTrend } from "./ledger/trends.js";
