/**
 * Loadout advisor (SSOT Step 4.15, pure). Diffs a player's journal `Loadout` against the
 * reference template for a target mining method: what mining modules are equipped, which
 * REQUIRED ones are missing ("no Pulse Wave Analyser — required for deep-core"), and which
 * RECOMMENDED ones to add. Suggestions are validated against the ship's slots so the advisor
 * NEVER recommends a module that doesn't fit; required gaps are always reported (with a
 * `fitsShip` flag) so "this ship can't do this method" is visible, not hidden.
 */

import type { MiningMethod } from "@lodestar/shared";
import type { ModuleCategory, ModuleSpec } from "./templates.js";
import { METHOD_TEMPLATES, detectModule } from "./templates.js";

export interface LoadoutModule {
  readonly slot: string;
  readonly item: string;
}

/** The sizes available in each slot category for the ship (from a ship-slot table). */
export interface ShipSlots {
  readonly hardpoints: readonly number[];
  readonly optionalInternals: readonly number[];
}

export interface EquippedModule {
  readonly kind: string;
  readonly label: string;
}

export interface ModuleGap {
  readonly kind: string;
  readonly label: string;
  readonly category: ModuleCategory;
  readonly minSize: number;
  readonly reason: string;
  /** Whether the ship has a slot that fits this module (true when slot data is unknown). */
  readonly fitsShip: boolean;
}

export interface LoadoutAdvice {
  readonly method: MiningMethod;
  readonly present: readonly EquippedModule[];
  readonly missingRequired: readonly ModuleGap[];
  readonly suggestions: readonly ModuleGap[];
}

function fits(spec: ModuleSpec, shipSlots: ShipSlots | undefined): boolean {
  if (shipSlots === undefined) return true; // unknown slots → don't claim it won't fit
  const slots = spec.category === "hardpoint" ? shipSlots.hardpoints : shipSlots.optionalInternals;
  return slots.some((size) => size >= spec.minSize);
}

const gap = (spec: ModuleSpec, reason: string, shipSlots: ShipSlots | undefined): ModuleGap => ({
  kind: spec.kind,
  label: spec.label,
  category: spec.category,
  minSize: spec.minSize,
  reason,
  fitsShip: fits(spec, shipSlots),
});

/**
 * Analyse a loadout for a target mining method. `shipSlots` (optional) validates that a
 * recommendation actually fits — omit it and no suggestion is filtered.
 */
export function analyzeLoadout(
  modules: readonly LoadoutModule[],
  method: MiningMethod,
  shipSlots?: ShipSlots,
): LoadoutAdvice {
  const equipped = new Map<string, EquippedModule>();
  for (const module of modules) {
    const spec = detectModule(module.item);
    if (spec !== undefined) equipped.set(spec.kind, { kind: spec.kind, label: spec.label });
  }
  const template = METHOD_TEMPLATES[method];

  const missingRequired = template.required
    .filter((spec) => !equipped.has(spec.kind))
    .map((spec) => gap(spec, `required for ${method}`, shipSlots));

  // Recommendations NEVER name a module that doesn't fit the ship.
  const suggestions = template.recommended
    .filter((spec) => !equipped.has(spec.kind) && fits(spec, shipSlots))
    .map((spec) => gap(spec, `recommended for ${method}`, shipSlots));

  return {
    method,
    present: [...equipped.values()],
    missingRequired,
    suggestions,
  };
}
