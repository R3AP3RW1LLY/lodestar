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
