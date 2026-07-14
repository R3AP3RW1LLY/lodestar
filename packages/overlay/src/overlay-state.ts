/**
 * The overlay's view model + the pure fold that maintains it (SSOT Step 2.10).
 * The overlay receives, over the loopback WS, a `state.snapshot` on connect (its
 * baseline), then `state.delta` updates and `assay.verdict` pushes. This module is
 * pure so the folding + selectors are fully unit-tested without a socket or DOM.
 */

import { applyStateDelta, initialRootState } from "@lodestar/shared";
import type {
  AssayMaterial,
  AssayVerdictEvent,
  EnvelopeShape,
  RootState,
  StateDelta,
} from "@lodestar/shared";

export interface OverlayModel {
  readonly state: RootState;
  readonly verdict: AssayVerdictEvent | null;
}

export function initialOverlayModel(): OverlayModel {
  return { state: initialRootState(), verdict: null };
}

/**
 * Fold one inbound envelope into the model. `state.snapshot` re-baselines the whole
 * state; `state.delta` applies a top-level-key delta; `assay.verdict` replaces the
 * shown verdict. Any other channel (session.stats, tts.audio, …) is ignored — the
 * overlay v1 shows only the verdict + cargo. Payloads are cast at the boundary
 * (outer envelope shape is already validated), mirroring the preload API consumer.
 */
export function foldEnvelope(model: OverlayModel, env: EnvelopeShape): OverlayModel {
  switch (env.channel) {
    case "state.snapshot":
      return { ...model, state: env.payload as RootState };
    case "state.delta":
      return { ...model, state: applyStateDelta(model.state, env.payload as StateDelta) };
    case "assay.verdict":
      return { ...model, verdict: env.payload as AssayVerdictEvent };
    default:
      return model;
  }
}

/** Cargo fill percent (0–100) against capacity, or undefined when capacity is unknown. */
export function cargoPercent(state: RootState): number | undefined {
  const cap = state.ship.cargoCapacity;
  if (cap === undefined || cap <= 0) return undefined;
  return Math.min(100, Math.max(0, (state.cargo.count / cap) * 100));
}

/** The dominant material of a verdict (highest proportion), or undefined if none. */
export function topMaterial(materials: readonly AssayMaterial[]): AssayMaterial | undefined {
  let best: AssayMaterial | undefined;
  for (const m of materials) {
    if (best === undefined || m.proportion > best.proportion) best = m;
  }
  return best;
}
