/**
 * Mining loadout templates (SSOT Step 4.15, pure). Per-method reference module sets:
 * which mining modules a method REQUIRES vs merely RECOMMENDS, each with the slot it needs
 * (hardpoint vs optional-internal) + a minimum size, and a substring that identifies it in
 * a journal `Loadout.Modules[].Item` internal name. Community-documented (internal names +
 * method requirements are verified against the game); the advisor (advisor.ts) diffs a
 * player's loadout against these.
 */

import type { MiningMethod } from "@lodestar/shared";

export type ModuleCategory = "hardpoint" | "optional-internal";

export interface ModuleSpec {
  readonly kind: string;
  readonly label: string;
  readonly category: ModuleCategory;
  readonly minSize: number;
  /** Lower-cased substring identifying this module in a journal `Item` internal name. */
  readonly match: string;
}

const M = {
  miningLaser: {
    kind: "mining-laser",
    label: "Mining Laser",
    category: "hardpoint",
    minSize: 1,
    match: "mininglaser",
  },
  pwa: {
    kind: "pwa",
    label: "Pulse Wave Analyser",
    category: "hardpoint",
    minSize: 0,
    match: "mrascanner",
  },
  abrasionBlaster: {
    kind: "abrasion-blaster",
    label: "Abrasion Blaster",
    category: "hardpoint",
    minSize: 1,
    match: "mining_abrblstr",
  },
  seismicLauncher: {
    kind: "seismic-launcher",
    label: "Seismic Charge Launcher",
    category: "hardpoint",
    minSize: 1,
    match: "mining_seismchrgwarhd",
  },
  subsurfaceMissile: {
    kind: "subsurface-missile",
    label: "Sub-surface Displacement Missile",
    category: "hardpoint",
    minSize: 1,
    match: "mining_subsurfdispmisl",
  },
  prospector: {
    kind: "prospector-controller",
    label: "Prospector Limpet Controller",
    category: "optional-internal",
    minSize: 1,
    match: "dronecontrol_prospector",
  },
  collector: {
    kind: "collector-controller",
    label: "Collector Limpet Controller",
    category: "optional-internal",
    minSize: 1,
    match: "dronecontrol_collection",
  },
  refinery: {
    kind: "refinery",
    label: "Refinery",
    category: "optional-internal",
    minSize: 1,
    match: "int_refinery",
  },
} as const satisfies Record<string, ModuleSpec>;

/** Every detectable mining module (for equipped-module detection). */
export const MINING_MODULES: readonly ModuleSpec[] = Object.values(M);

export interface MethodTemplate {
  readonly method: MiningMethod;
  readonly required: readonly ModuleSpec[];
  readonly recommended: readonly ModuleSpec[];
  readonly note: string;
}

/** The reference loadout per mining method (provisional — verified in-game). */
export const METHOD_TEMPLATES: Readonly<Record<MiningMethod, MethodTemplate>> = {
  laser: {
    method: "laser",
    required: [M.miningLaser, M.refinery, M.prospector, M.collector],
    recommended: [M.abrasionBlaster],
    note: "Mining lasers + refinery + limpet controllers; abrasion blaster for surface deposits.",
  },
  "deep-core": {
    method: "deep-core",
    required: [M.seismicLauncher, M.pwa, M.refinery, M.collector],
    recommended: [M.prospector, M.abrasionBlaster],
    note: "PWA to find core asteroids + Seismic Charge Launcher to crack them; refinery + collectors.",
  },
  subsurface: {
    method: "subsurface",
    required: [M.subsurfaceMissile, M.refinery, M.collector],
    recommended: [M.pwa, M.prospector],
    note: "Sub-surface Displacement Missile for sub-surface deposits; PWA helps spot them.",
  },
};

/** Detect which mining module a journal `Item` internal name is (or undefined). */
export function detectModule(item: string): ModuleSpec | undefined {
  const lower = item.toLowerCase();
  return MINING_MODULES.find((spec) => lower.includes(spec.match));
}
