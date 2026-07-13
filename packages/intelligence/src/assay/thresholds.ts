/**
 * Worth-mining threshold matrix (SSOT Step 2.3). Pure defaults: a commodity ×
 * method matrix keyed by canonical id (so a typo'd id fails to COMPILE), each
 * entry carrying a minimum worth-mining proportion (%) and a provenance note.
 * These are PROVISIONAL, community-documented starting points — verified in-game
 * before shipping as defaults; the user's overrides (persisted in `core`) win.
 * The motherlode always-mine rule lives here too; the SKIP-when-depleted
 * precedence is resolved by the verdict engine (Step 2.4).
 */

import type { CommodityId, MiningMethod } from "@lodestar/shared";

export interface ThresholdEntry {
  readonly commodityId: CommodityId;
  readonly method: MiningMethod;
  /** Minimum proportion (%) at or above which a rock is worth mining. */
  readonly minProportion: number;
  /** Provenance: how this default was arrived at. */
  readonly note: string;
}

const CD = "community-documented; verify in-game";
const DEEP = "deep-core gemstone — worth cracking on any hit; motherlode rule dominates (2.4)";

function t(
  commodityId: CommodityId,
  method: MiningMethod,
  minProportion: number,
  note = CD,
): ThresholdEntry {
  return { commodityId, method, minProportion, note };
}

export const DEFAULT_THRESHOLDS: readonly ThresholdEntry[] = [
  // Laser (proportion-driven; higher-value → lower acceptable %)
  t("platinum", "laser", 25),
  t("painite", "laser", 25),
  t("osmium", "laser", 25),
  t("palladium", "laser", 20),
  t("gold", "laser", 20),
  t("lowtemperaturediamond", "laser", 20),
  t("bromellite", "laser", 20),
  t("tritium", "laser", 15, "fuel commodity, lower value → lower threshold (community-documented)"),
  // Deep-core (cracked whole; low presence floor — the motherlode rule dominates)
  t("opal", "deep-core", 5, DEEP),
  t("lowtemperaturediamond", "deep-core", 5, DEEP),
  t("alexandrite", "deep-core", 5, DEEP),
  t("benitoite", "deep-core", 5, DEEP),
  t("musgravite", "deep-core", 5, DEEP),
  t("serendibite", "deep-core", 5, DEEP),
  t("grandidierite", "deep-core", 5, DEEP),
  t("monazite", "deep-core", 5, DEEP),
  t("rhodplumsite", "deep-core", 5, DEEP),
  t("painite", "deep-core", 5, DEEP),
  t("bromellite", "deep-core", 5, DEEP),
  // Subsurface (displacement missiles)
  t("lowtemperaturediamond", "subsurface", 15),
  t("platinum", "subsurface", 20),
  t("painite", "subsurface", 20),
  t("bromellite", "subsurface", 15),
  t("tritium", "subsurface", 10),
];

/** Motherlode rocks are always worth mining — unless depleted (SKIP precedence in 2.4). */
export const MOTHERLODE_ALWAYS_MINE = true;

const key = (commodityId: string, method: MiningMethod): string =>
  JSON.stringify([commodityId, method]);
const DEFAULTS = new Map(
  DEFAULT_THRESHOLDS.map((e) => [key(e.commodityId, e.method), e.minProportion]),
);

/** The default worth-mining proportion for a commodity+method, or undefined (not worth mining). */
export function defaultThreshold(commodityId: string, method: MiningMethod): number | undefined {
  return DEFAULTS.get(key(commodityId, method));
}

/** A user threshold override (shape provided by `core`'s validated store). */
export interface ThresholdOverrideInput {
  readonly commodityId: string;
  readonly method: MiningMethod;
  readonly minProportion: number;
}

/**
 * Merge user overrides over the defaults, returning a resolver. An override wins
 * over the default for the same commodity+method; undefined ⇒ not worth mining.
 */
export function mergeThresholds(
  overrides: readonly ThresholdOverrideInput[] = [],
): (commodityId: string, method: MiningMethod) => number | undefined {
  const merged = new Map(DEFAULTS);
  for (const o of overrides) merged.set(key(o.commodityId, o.method), o.minProportion);
  return (commodityId, method) => merged.get(key(commodityId, method));
}
