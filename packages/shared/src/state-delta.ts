/**
 * RootState deltas (SSOT §5.6 / Step 1.9). The main process sends a full
 * `state.snapshot` on subscribe, then throttled `state.delta`s carrying only the
 * top-level keys whose VALUE changed. `reduce` always returns a fresh object, so
 * diffing must be structural (value equality), never referential. Both sides use
 * these pure helpers: main to produce deltas, the renderer store to apply them.
 */

import type { RootState } from "./state.js";

export type StateDelta = Partial<RootState>;

const KEYS: readonly (keyof RootState)[] = [
  "ship",
  "location",
  "cargo",
  "activity",
  "pips",
  "flags",
  "flags2",
  "timestamp",
];

/** Structural equality for the JSON-value shapes RootState is built from. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => Object.hasOwn(bo, k) && deepEqual(ao[k], bo[k]));
  }
  return false;
}

/**
 * The top-level keys whose value differs, carrying the NEXT value. RootState
 * optionals (flags/pips/timestamp) only ever go undefined→defined in the live
 * pipeline, so a delta never needs to represent a key removal — an unchanged or
 * still-undefined key is simply omitted.
 */
export function diffRootState(prev: RootState, next: RootState): StateDelta {
  const delta: Record<string, unknown> = {};
  for (const key of KEYS) {
    const nextVal = next[key];
    if (nextVal !== undefined && !deepEqual(prev[key], nextVal)) {
      delta[key] = nextVal;
    }
  }
  return delta;
}

/** Apply a delta onto a base state — the exact inverse of `diffRootState`. */
export function applyStateDelta(state: RootState, delta: StateDelta): RootState {
  return { ...state, ...delta };
}
