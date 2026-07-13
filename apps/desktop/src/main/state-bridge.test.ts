import { describe, expect, it } from "vitest";
import type { Envelope, RootState, SessionSummary } from "@lodestar/shared";
import { initialRootState, isEnvelope } from "@lodestar/shared";
import { createStateBridge } from "./state-bridge.js";

/** A hand-driven engine view: tests push state/session and observe the bridge. */
function fakeEngine() {
  let state: RootState = initialRootState();
  let session: SessionSummary | null = null;
  const stateSubs = new Set<(s: RootState) => void>();
  const sessionSubs = new Set<(s: SessionSummary | null) => void>();
  return {
    view: {
      state: () => state,
      session: () => session,
      onState: (fn: (s: RootState) => void) => {
        stateSubs.add(fn);
        return () => stateSubs.delete(fn);
      },
      onSession: (fn: (s: SessionSummary | null) => void) => {
        sessionSubs.add(fn);
        return () => sessionSubs.delete(fn);
      },
    },
    setState(next: RootState) {
      state = next;
      for (const fn of stateSubs) fn(next);
    },
    setSession(next: SessionSummary | null) {
      session = next;
      for (const fn of sessionSubs) fn(next);
    },
  };
}

/** A timer the test fires by hand, so throttling is deterministic. */
function manualTimer() {
  let pending: (() => void) | undefined;
  let scheduleCount = 0;
  return {
    setTimer: (fn: () => void) => {
      pending = fn;
      scheduleCount += 1;
      return scheduleCount;
    },
    clearTimer: () => {
      pending = undefined;
    },
    fire() {
      const fn = pending;
      pending = undefined;
      fn?.();
    },
    get scheduleCount() {
      return scheduleCount;
    },
  };
}

function mining(tons: number): SessionSummary {
  return {
    active: true,
    startedAt: "2025-06-01T12:00:00Z",
    tonsRefined: tons,
    tonsPerHour: 0,
    creditsEarned: 0,
    creditsPerHour: 0,
    limpetsLaunched: 0,
    bankedToCarrier: 0,
  };
}

describe("createStateBridge", () => {
  it("snapshot() returns the current state and pushes the current session.stats", () => {
    const eng = fakeEngine();
    eng.setSession(mining(3));
    const sent: Envelope[] = [];
    const bridge = createStateBridge({ engine: eng.view, send: (e) => sent.push(e) });

    const snap = bridge.snapshot();
    expect(snap).toEqual(eng.view.state()); // full state returns over the invoke
    expect(sent.map((e) => e.channel)).toEqual(["session.stats"]); // state is NOT re-pushed
    expect(sent[0]?.payload).toMatchObject({ tonsRefined: 3 });
    bridge.stop();
  });

  it("coalesces rapid state changes into a single throttled delta of the latest values", () => {
    const eng = fakeEngine();
    const timer = manualTimer();
    const sent: Envelope[] = [];
    const bridge = createStateBridge({
      engine: eng.view,
      send: (e) => sent.push(e),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });
    bridge.snapshot(); // baseline
    sent.length = 0;

    // Five rapid updates before the throttle window elapses.
    for (const activity of ["supercruise", "mining", "docked", "mining", "traveling"] as const) {
      eng.setState({ ...eng.view.state(), activity });
    }
    expect(timer.scheduleCount).toBe(1); // only one timer scheduled for the burst
    expect(sent).toHaveLength(0); // nothing sent until it fires

    timer.fire();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.channel).toBe("state.delta");
    expect(sent[0]?.payload).toEqual({ activity: "traveling" }); // latest value only
    bridge.stop();
  });

  it("emits nothing on flush when the state has not changed since the last send", () => {
    const eng = fakeEngine();
    const timer = manualTimer();
    const sent: Envelope[] = [];
    const bridge = createStateBridge({
      engine: eng.view,
      send: (e) => sent.push(e),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });
    bridge.snapshot();
    sent.length = 0;
    eng.setState(initialRootState()); // structurally identical to the baseline
    timer.fire();
    expect(sent).toHaveLength(0);
    bridge.stop();
  });

  it("pushes session.stats through the same throttle", () => {
    const eng = fakeEngine();
    const timer = manualTimer();
    const sent: Envelope[] = [];
    const bridge = createStateBridge({
      engine: eng.view,
      send: (e) => sent.push(e),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });
    eng.setSession(mining(1));
    eng.setSession(mining(2));
    timer.fire();
    const sessionEnvelopes = sent.filter((e) => e.channel === "session.stats");
    expect(sessionEnvelopes).toHaveLength(1);
    expect(sessionEnvelopes[0]?.payload).toMatchObject({ tonsRefined: 2 });
    bridge.stop();
  });

  it("every message it sends is a valid §5.6 envelope", () => {
    const eng = fakeEngine();
    const sent: Envelope[] = [];
    const bridge = createStateBridge({
      engine: eng.view,
      send: (e) => sent.push(e),
      envelopeNow: () => new Date("2025-06-01T12:00:00Z"),
    });
    bridge.snapshot();
    eng.setState({ ...eng.view.state(), activity: "mining" });
    eng.setSession(mining(5));
    bridge.flush();
    expect(sent.length).toBeGreaterThan(0);
    for (const env of sent) {
      expect(isEnvelope(env)).toBe(true);
      expect(env.ts).toBe("2025-06-01T12:00:00.000Z");
    }
    bridge.stop();
  });

  it("isolates a throwing flush send — reports it, doesn't crash, and retries the lost delta", () => {
    const eng = fakeEngine();
    const timer = manualTimer();
    const errors: unknown[] = [];
    const sent: Envelope[] = [];
    let failNext = false;
    const bridge = createStateBridge({
      engine: eng.view,
      send: (e) => {
        if (failNext) throw new Error("webContents destroyed");
        sent.push(e);
      },
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
      onError: (e) => errors.push(e),
    });
    bridge.snapshot(); // baseline established
    sent.length = 0;

    // First flush throws inside the timer callback → isolated + reported, and the
    // baseline is NOT advanced (so the change isn't silently lost).
    eng.setState({ ...eng.view.state(), activity: "mining" });
    failNext = true;
    expect(() => {
      timer.fire();
    }).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(sent).toHaveLength(0);

    // Next flush succeeds → the same delta is retried, not dropped.
    failNext = false;
    eng.setState({ ...eng.view.state(), activity: "mining" }); // reschedules; state unchanged since the failed attempt
    timer.fire();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.payload).toEqual({ activity: "mining" });
    bridge.stop();
  });

  it("stop() cancels a pending flush and unsubscribes", () => {
    const eng = fakeEngine();
    const timer = manualTimer();
    const sent: Envelope[] = [];
    const bridge = createStateBridge({
      engine: eng.view,
      send: (e) => sent.push(e),
      setTimer: timer.setTimer,
      clearTimer: timer.clearTimer,
    });
    eng.setState({ ...eng.view.state(), activity: "mining" });
    bridge.stop();
    timer.fire(); // cleared — no-op
    eng.setState({ ...eng.view.state(), activity: "docked" }); // unsubscribed
    expect(sent).toHaveLength(0);
  });
});
