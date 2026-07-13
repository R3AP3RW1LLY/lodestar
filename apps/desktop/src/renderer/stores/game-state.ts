/**
 * Renderer game-state store (SSOT Step 1.9). A Zustand store hydrated from the
 * `state.snapshot` invoke and kept live by `state.delta` / `session.stats`
 * pushes. `subscribeGameState` wires the preload API to the store and closes the
 * hydrate/delta race: deltas that arrive before the snapshot resolves are
 * buffered and replayed in order once hydrated, so no update is lost or applied
 * to the wrong base.
 */

import { create } from "zustand";
import type { RootState, SessionSummary, StateDelta } from "@lodestar/shared";
import { applyStateDelta, initialRootState } from "@lodestar/shared";

export interface GameState {
  readonly state: RootState;
  readonly session: SessionSummary | null;
  /** True once the initial snapshot has hydrated the store. */
  readonly connected: boolean;
  hydrate: (snapshot: RootState) => void;
  applyDelta: (delta: StateDelta) => void;
  setSession: (session: SessionSummary | null) => void;
}

export const useGameState = create<GameState>((set) => ({
  state: initialRootState(),
  session: null,
  connected: false,
  hydrate: (snapshot) => {
    set({ state: snapshot, connected: true });
  },
  applyDelta: (delta) => {
    set((prev) => ({ state: applyStateDelta(prev.state, delta) }));
  },
  setSession: (session) => {
    set({ session });
  },
}));

/** The slice of the preload API the store subscription consumes. */
export interface GameStateApi {
  getStateSnapshot: () => Promise<RootState>;
  onStateDelta: (cb: (delta: StateDelta) => void) => () => void;
  onSessionStats: (cb: (session: SessionSummary | null) => void) => () => void;
}

type StoreActions = Pick<GameState, "hydrate" | "applyDelta" | "setSession">;

/**
 * Wire the preload API to the store. Returns an unsubscribe that detaches the
 * push listeners. Listeners are attached BEFORE the snapshot is requested so no
 * push is missed; early deltas are buffered and replayed after hydration.
 */
export function subscribeGameState(
  api: GameStateApi,
  store: StoreActions = useGameState.getState(),
): () => void {
  let hydrated = false;
  const buffer: StateDelta[] = [];

  const offDelta = api.onStateDelta((delta) => {
    if (hydrated) store.applyDelta(delta);
    else buffer.push(delta);
  });
  const offSession = api.onSessionStats((session) => {
    store.setSession(session);
  });

  api
    .getStateSnapshot()
    .then((snapshot) => {
      store.hydrate(snapshot);
      for (const delta of buffer) store.applyDelta(delta);
      buffer.length = 0;
      hydrated = true;
    })
    .catch(() => {
      // The snapshot could not be fetched (main not ready). Listeners stay
      // attached and buffered deltas are retained; the caller (Step 1.10's
      // Command Deck) owns re-invoking to hydrate — this function does not retry.
    });

  return () => {
    offDelta();
    offSession();
  };
}
