/**
 * State bridge (SSOT Step 1.9). Subscribes to the live engine and pushes the
 * root state to the renderer over IPC: a full `state.snapshot` when a renderer
 * subscribes, then coalesced `state.delta`s (only changed top-level keys) and
 * `session.stats`, throttled to ≤ 10 Hz. Everything crosses as a §5.6 Envelope —
 * the renderer never receives a non-envelope message. Injected timer + clock keep
 * the throttle deterministic under test.
 */

import type {
  ChannelPayloads,
  Envelope,
  RootState,
  SessionSummary,
  StateDelta,
} from "@lodestar/shared";
import { diffRootState, envelope, initialRootState } from "@lodestar/shared";

/** The slice of the live engine the bridge observes (structurally the engine). */
export interface EngineView {
  state: () => RootState;
  session: () => SessionSummary | null;
  onState: (fn: (state: RootState) => void) => () => void;
  onSession: (fn: (session: SessionSummary | null) => void) => () => void;
}

export interface StateBridgeDeps {
  readonly engine: EngineView;
  /** Push an envelope to the renderer (wraps webContents.send in production). */
  readonly send: (env: Envelope) => void;
  readonly throttleMs?: number;
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Clock for the envelope `ts` (injected so tests are deterministic). */
  readonly envelopeNow?: () => Date;
  /** Notified if a push throws (e.g. a destroyed-window race) — never rethrown. */
  readonly onError?: (error: unknown) => void;
}

export interface StateBridge {
  /**
   * A renderer subscribed: re-baseline to the current full state, push it as a
   * `state.snapshot` plus the current `session.stats`, and return the snapshot so
   * the invoke handler can also resolve with it.
   */
  snapshot: () => RootState;
  /** Force any pending delta/session out immediately (shutdown / tests). */
  flush: () => void;
  stop: () => void;
}

export function createStateBridge(deps: StateBridgeDeps): StateBridge {
  const throttleMs = deps.throttleMs ?? 100;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ??
    ((h) => {
      clearTimeout(h as ReturnType<typeof setTimeout>);
    });
  const stamp = deps.envelopeNow;

  const wrap = <C extends "state.delta" | "session.stats">(
    channel: C,
    payload: ChannelPayloads[C],
  ): Envelope =>
    stamp === undefined ? envelope(channel, payload) : envelope(channel, payload, stamp);

  // Baseline the renderer is known to hold; deltas are diffed against it.
  let lastSent: RootState = initialRootState();
  let sessionDirty = false;
  let pendingSession: SessionSummary | null = null;
  let timer: unknown;

  function doFlush(): void {
    timer = undefined;
    // A push runs in a bare timer callback — an uncaught throw here (e.g. a
    // window destroyed between the guard and send) would crash the main process.
    // Isolate it, and only advance the baseline / clear the dirty flag AFTER a
    // successful send so a failed push is retried on the next flush, not lost.
    try {
      const current = deps.engine.state();
      const delta: StateDelta = diffRootState(lastSent, current);
      if (Object.keys(delta).length > 0) {
        deps.send(wrap("state.delta", delta));
        lastSent = current;
      }
      if (sessionDirty) {
        deps.send(wrap("session.stats", pendingSession));
        sessionDirty = false;
      }
    } catch (error) {
      deps.onError?.(error);
    }
  }

  function schedule(): void {
    if (timer === undefined) timer = setTimer(doFlush, throttleMs);
  }

  const offState = deps.engine.onState(() => {
    schedule();
  });
  const offSession = deps.engine.onSession((session) => {
    pendingSession = session;
    sessionDirty = true;
    schedule();
  });

  return {
    snapshot: () => {
      // The full state travels back over the `state.snapshot` invoke return, so
      // it is NOT pushed here; we only re-baseline (subsequent deltas diff against
      // it) and push the current session so a freshly-subscribed renderer has it.
      const current = deps.engine.state();
      lastSent = current;
      deps.send(wrap("session.stats", deps.engine.session()));
      return current;
    },
    flush: doFlush,
    stop: () => {
      if (timer !== undefined) {
        clearTimer(timer);
        timer = undefined;
      }
      offState();
      offSession();
    },
  };
}
