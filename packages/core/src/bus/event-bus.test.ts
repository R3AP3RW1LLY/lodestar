import { describe, expect, it } from "vitest";
import { EventBus } from "./event-bus.js";
import type { BusLogger } from "./event-bus.js";

interface TestEvents {
  tick: number;
  msg: string;
  snapshot: { readonly v: number };
}

function warnSpy(): BusLogger & {
  calls: { msg: string; fields: Record<string, unknown> | undefined }[];
} {
  const calls: { msg: string; fields: Record<string, unknown> | undefined }[] = [];
  return { warn: (msg, fields) => calls.push({ msg, fields }), calls };
}

describe("EventBus", () => {
  it("dispatches to subscribers of the matching type, synchronously and in subscription order", () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    bus.subscribe("tick", (n) => order.push(`a:${String(n)}`));
    bus.subscribe("tick", (n) => order.push(`b:${String(n)}`));
    bus.subscribe("msg", () => order.push("msg-should-not-fire"));
    bus.publish("tick", 7);
    // Synchronous: everything already happened before publish returned.
    expect(order).toEqual(["a:7", "b:7"]);
  });

  it("delivers only to the subscribed type (type isolation)", () => {
    const bus = new EventBus<TestEvents>();
    const ticks: number[] = [];
    const msgs: string[] = [];
    bus.subscribe("tick", (n) => ticks.push(n));
    bus.subscribe("msg", (m) => msgs.push(m));
    bus.publish("tick", 1);
    bus.publish("msg", "hi");
    bus.publish("tick", 2);
    expect(ticks).toEqual([1, 2]);
    expect(msgs).toEqual(["hi"]);
  });

  it("stops delivering after unsubscribe", () => {
    const bus = new EventBus<TestEvents>();
    const seen: number[] = [];
    const sub = bus.subscribe("tick", (n) => seen.push(n));
    bus.publish("tick", 1);
    sub.unsubscribe();
    bus.publish("tick", 2);
    expect(seen).toEqual([1]);
  });

  it("isolates a throwing subscriber: logs it, detaches it, and still calls the others", () => {
    const logger = warnSpy();
    const bus = new EventBus<TestEvents>({ logger });
    const good1: number[] = [];
    const good2: number[] = [];
    bus.subscribe("tick", () => {
      throw new Error("boom");
    });
    bus.subscribe("tick", (n) => good1.push(n));
    bus.publish("tick", 1);
    // The other subscribers still ran despite the exception.
    expect(good1).toEqual([1]);
    expect(logger.calls.some((c) => c.msg === "bus.subscriber-threw")).toBe(true);
    // The thrower is DETACHED — it does not run again on the next publish.
    let threwAgain = false;
    bus.subscribe("tick", (n) => good2.push(n));
    try {
      bus.publish("tick", 2);
    } catch {
      threwAgain = true;
    }
    expect(threwAgain).toBe(false);
    expect(good1).toEqual([1, 2]);
    expect(good2).toEqual([2]);
    expect(logger.calls.filter((c) => c.msg === "bus.subscriber-threw")).toHaveLength(1);
  });

  it("replays the last value to a NEW subscriber of a replay channel", () => {
    const bus = new EventBus<TestEvents>({ replayTypes: ["snapshot"] });
    bus.publish("snapshot", { v: 42 });
    const seen: number[] = [];
    bus.subscribe("snapshot", (s) => seen.push(s.v)); // subscribes AFTER the publish
    expect(seen).toEqual([42]); // got the last value immediately
    bus.publish("snapshot", { v: 43 });
    expect(seen).toEqual([42, 43]);
  });

  it("does not replay non-replay channels", () => {
    const bus = new EventBus<TestEvents>({ replayTypes: ["snapshot"] });
    bus.publish("tick", 99);
    const seen: number[] = [];
    bus.subscribe("tick", (n) => seen.push(n));
    expect(seen).toEqual([]); // no replay for a non-replay type
  });

  it("a subscriber that unsubscribes another mid-dispatch prevents that one from firing", () => {
    const bus = new EventBus<TestEvents>();
    const seen: string[] = [];
    const holder: { other?: { unsubscribe: () => void } } = {};
    bus.subscribe("tick", () => {
      seen.push("first");
      holder.other?.unsubscribe();
    });
    holder.other = bus.subscribe("tick", () => seen.push("second"));
    bus.publish("tick", 1);
    expect(seen).toEqual(["first"]); // "second" was unsubscribed before it could run
  });

  it("processes a re-entrant publish FIFO (global order preserved), both subscribers first", () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    bus.subscribe("tick", (n) => {
      order.push(`a:${String(n)}`);
      if (n < 3) bus.publish("tick", n + 1); // re-entrant publish from inside a listener
    });
    bus.subscribe("tick", (n) => order.push(`b:${String(n)}`));
    bus.publish("tick", 1);
    // tick 1 reaches BOTH subscribers before the queued tick 2 is dispatched, etc.
    expect(order).toEqual(["a:1", "b:1", "a:2", "b:2", "a:3", "b:3"]);
  });

  it("does not stack-overflow on a long re-entrant cascade", () => {
    const bus = new EventBus<TestEvents>();
    let count = 0;
    bus.subscribe("tick", (n) => {
      count += 1;
      if (n < 5000) bus.publish("tick", n + 1);
    });
    expect(() => {
      bus.publish("tick", 1);
    }).not.toThrow();
    expect(count).toBe(5000);
  });

  it("publishing with no subscribers is a harmless no-op", () => {
    const bus = new EventBus<TestEvents>();
    expect(() => {
      bus.publish("tick", 1);
    }).not.toThrow();
  });

  it("replayed delivery to a throwing new subscriber is isolated too", () => {
    const logger = warnSpy();
    const bus = new EventBus<TestEvents>({ replayTypes: ["snapshot"], logger });
    bus.publish("snapshot", { v: 1 });
    expect(() => {
      bus.subscribe("snapshot", () => {
        throw new Error("boom-on-replay");
      });
    }).not.toThrow();
    expect(logger.calls.some((c) => c.msg === "bus.subscriber-threw")).toBe(true);
  });

  it("uses a stable dispatch snapshot: a subscriber added during dispatch waits for the next publish", () => {
    const bus = new EventBus<TestEvents>();
    const seen: string[] = [];
    let added = false;
    bus.subscribe("tick", () => {
      seen.push("first");
      if (!added) {
        added = true;
        bus.subscribe("tick", () => seen.push("late"));
      }
    });
    bus.publish("tick", 1);
    expect(seen).toEqual(["first"]); // "late" does not fire for the in-flight event
    bus.publish("tick", 2);
    // subscription order: "first" then the later-added "late".
    expect(seen).toEqual(["first", "first", "late"]);
  });
});
