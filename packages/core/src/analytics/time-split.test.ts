import { describe, expect, it } from "vitest";
import { aggregateTimeSplit, sessionTimeSplit } from "./time-split.js";

describe("sessionTimeSplit (pure)", () => {
  it("counts consecutive mining events within the gap threshold as mining, the rest as other", () => {
    const split = sessionTimeSplit(
      [
        { eventType: "LaunchDrone", timestamp: "2025-06-01T12:00:00Z" },
        { eventType: "MiningRefined", timestamp: "2025-06-01T12:01:00Z" }, // +60 s ≤ 300 → mining
        { eventType: "MiningRefined", timestamp: "2025-06-01T12:09:00Z" }, // +480 s > 300 → other
        { eventType: "MarketSell", timestamp: "2025-06-01T12:09:30Z" }, // not a mining event
      ],
      "2025-06-01T12:00:00Z",
      "2025-06-01T12:10:00Z",
    );
    expect(split).toEqual({ durationSec: 600, miningSec: 60, otherSec: 540, miningRatio: 0.1 });
  });

  it("reconciles mining + other to the full duration, and handles an active/degenerate session", () => {
    const split = sessionTimeSplit([], "2025-06-01T12:00:00Z", null);
    expect(split).toEqual({ durationSec: 0, miningSec: 0, otherSec: 0, miningRatio: 0 });
    const one = sessionTimeSplit(
      [{ eventType: "MiningRefined", timestamp: "2025-06-01T12:05:00Z" }],
      "2025-06-01T12:00:00Z",
      "2025-06-01T12:10:00Z",
    );
    // A single event has no gap to accumulate → all "other", but still reconciles.
    expect(one.miningSec + one.otherSec).toBe(one.durationSec);
    expect(one.durationSec).toBe(600);
  });

  it("honours a custom gap threshold", () => {
    const events = [
      { eventType: "MiningRefined", timestamp: "2025-06-01T12:00:00Z" },
      { eventType: "MiningRefined", timestamp: "2025-06-01T12:07:00Z" }, // 420 s gap
    ];
    // Default 300 s → the gap is "other"; a 600 s threshold counts it as mining.
    expect(sessionTimeSplit(events, "2025-06-01T12:00:00Z", "2025-06-01T12:10:00Z").miningSec).toBe(
      0,
    );
    expect(
      sessionTimeSplit(events, "2025-06-01T12:00:00Z", "2025-06-01T12:10:00Z", 600).miningSec,
    ).toBe(420);
  });
});

describe("aggregateTimeSplit (pure)", () => {
  it("pools durations + mining time and recomputes the ratio", () => {
    const totals = aggregateTimeSplit([
      { durationSec: 600, miningSec: 300, otherSec: 300, miningRatio: 0.5 },
      { durationSec: 400, miningSec: 100, otherSec: 300, miningRatio: 0.25 },
    ]);
    expect(totals).toEqual({
      sessions: 2,
      durationSec: 1000,
      miningSec: 400,
      otherSec: 600,
      miningRatio: 0.4,
    });
  });
});
