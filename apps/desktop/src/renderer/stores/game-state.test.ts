import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RootState, SessionSummary, StateDelta } from "@lodestar/shared";
import { initialRootState } from "@lodestar/shared";
import { subscribeGameState, useGameState } from "./game-state.js";
import type { GameStateApi } from "./game-state.js";

beforeEach(() => {
  useGameState.setState({ state: initialRootState(), session: null, connected: false });
});

describe("useGameState store", () => {
  it("hydrate replaces the state and marks connected", () => {
    const snap: RootState = { ...initialRootState(), activity: "mining" };
    useGameState.getState().hydrate(snap);
    expect(useGameState.getState().state).toEqual(snap);
    expect(useGameState.getState().connected).toBe(true);
  });

  it("applyDelta merges only the changed keys", () => {
    useGameState.getState().hydrate(initialRootState());
    useGameState
      .getState()
      .applyDelta({ activity: "supercruise", timestamp: "2025-06-01T12:00:00Z" });
    expect(useGameState.getState().state.activity).toBe("supercruise");
    expect(useGameState.getState().state.timestamp).toBe("2025-06-01T12:00:00Z");
    expect(useGameState.getState().state.location.docked).toBe(false); // untouched
  });

  it("setSession stores the session summary (including null)", () => {
    const session: SessionSummary = {
      active: true,
      startedAt: "2025-06-01T12:00:00Z",
      tonsRefined: 4,
      tonsPerHour: 10,
      creditsEarned: 0,
      creditsPerHour: 0,
      limpetsLaunched: 2,
      bankedToCarrier: 0,
    };
    useGameState.getState().setSession(session);
    expect(useGameState.getState().session).toEqual(session);
    useGameState.getState().setSession(null);
    expect(useGameState.getState().session).toBeNull();
  });
});

/** A controllable preload-API double for the subscription glue. */
function fakeApi() {
  let deltaCb: ((d: StateDelta) => void) | undefined;
  let sessionCb: ((s: SessionSummary | null) => void) | undefined;
  let resolveSnapshot: ((s: RootState) => void) | undefined;
  const offDelta = vi.fn();
  const offSession = vi.fn();
  const api: GameStateApi = {
    getStateSnapshot: () =>
      new Promise<RootState>((resolve) => {
        resolveSnapshot = resolve;
      }),
    onStateDelta: (cb) => {
      deltaCb = cb;
      return offDelta;
    },
    onSessionStats: (cb) => {
      sessionCb = cb;
      return offSession;
    },
  };
  return {
    api,
    offDelta,
    offSession,
    emitDelta: (d: StateDelta) => deltaCb?.(d),
    emitSession: (s: SessionSummary | null) => sessionCb?.(s),
    resolveSnapshot: (s: RootState) => resolveSnapshot?.(s),
  };
}

describe("subscribeGameState", () => {
  it("buffers deltas that arrive before hydration and replays them in order", async () => {
    const applied: StateDelta[] = [];
    const hydrated: RootState[] = [];
    const store = {
      hydrate: (s: RootState) => hydrated.push(s),
      applyDelta: (d: StateDelta) => applied.push(d),
      setSession: vi.fn(),
    };
    const f = fakeApi();
    subscribeGameState(f.api, store);

    // Two deltas arrive BEFORE the snapshot resolves — must be buffered, not lost.
    f.emitDelta({ activity: "supercruise" });
    f.emitDelta({ activity: "mining" });
    expect(applied).toEqual([]); // nothing applied yet
    expect(hydrated).toEqual([]);

    f.resolveSnapshot({ ...initialRootState(), activity: "docked" });
    await Promise.resolve(); // let the snapshot .then run

    expect(hydrated).toHaveLength(1); // hydrated first
    expect(applied).toEqual([{ activity: "supercruise" }, { activity: "mining" }]); // then replayed in order

    // A delta after hydration applies immediately.
    f.emitDelta({ activity: "traveling" });
    expect(applied).toEqual([
      { activity: "supercruise" },
      { activity: "mining" },
      { activity: "traveling" },
    ]);
  });

  it("forwards session pushes and unsubscribes both channels", async () => {
    const f = fakeApi();
    const setSession = vi.fn();
    const off = subscribeGameState(f.api, {
      hydrate: vi.fn(),
      applyDelta: vi.fn(),
      setSession,
    });
    f.resolveSnapshot(initialRootState());
    await Promise.resolve();
    f.emitSession(null);
    expect(setSession).toHaveBeenCalledWith(null);
    off();
    expect(f.offDelta).toHaveBeenCalledOnce();
    expect(f.offSession).toHaveBeenCalledOnce();
  });

  it("hydrates the real store end to end", async () => {
    const f = fakeApi();
    subscribeGameState(f.api);
    f.resolveSnapshot({ ...initialRootState(), activity: "mining" });
    await Promise.resolve();
    expect(useGameState.getState().connected).toBe(true);
    expect(useGameState.getState().state.activity).toBe("mining");
  });
});
