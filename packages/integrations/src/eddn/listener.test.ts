import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { nullLogger } from "@lodestar/shared";
import { createEddnListener, decodeEddnFrame } from "./listener.js";
import type { EddnEvent, EddnListenerDeps, EddnSource } from "./listener.js";
import type { EddnMarketMessage } from "./commodity-schema.js";
import { EDDN_PAESIA_MARKET, EDDN_WRONG_SCHEMA } from "./fixtures.js";

const frameOf = (value: unknown): Uint8Array => deflateSync(Buffer.from(JSON.stringify(value)));
const PAESIA_FRAME = frameOf(EDDN_PAESIA_MARKET);

const collectingSink = () => {
  const markets: EddnMarketMessage[] = [];
  return { markets, sink: { record: (m: EddnMarketMessage) => markets.push(m) } };
};

/** A fake publisher: each `stream()` call replays the next session's events. */
function fakeSource(sessions: EddnEvent[][]): EddnSource {
  let i = 0;
  return {
    stream: () => {
      const session = sessions[i] ?? [];
      i += 1;
      return (async function* () {
        await Promise.resolve();
        for (const event of session) yield event;
      })();
    },
  };
}

const baseDeps = (over: Partial<EddnListenerDeps>): EddnListenerDeps => ({
  source: fakeSource([[]]),
  sink: { record: () => undefined },
  sleep: async () => {
    await Promise.resolve();
  },
  now: () => 0,
  isEnabled: () => true,
  rand: () => 0.5,
  ...over,
});

describe("decodeEddnFrame", () => {
  it("zlib-inflates + JSON-parses a real frame (round trip)", () => {
    const decoded = decodeEddnFrame(PAESIA_FRAME);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value).toHaveProperty("$schemaRef");
  });

  it("rejects a non-zlib frame", () => {
    const r = decodeEddnFrame(new Uint8Array([1, 2, 3, 4]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("eddn/inflate");
  });

  it("rejects an inflated frame that isn't JSON", () => {
    const r = decodeEddnFrame(deflateSync(Buffer.from("not json")));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("eddn/json");
  });
});

describe("createEddnListener — ingestion pipeline", () => {
  it("decodes a recorded frame and records the accepted market", async () => {
    const { markets, sink } = collectingSink();
    const listener = createEddnListener(
      baseDeps({
        source: fakeSource([[{ kind: "frame", frame: PAESIA_FRAME }, { kind: "closed" }]]),
        sink,
        isEnabled: (() => {
          let live = true;
          return () => {
            const was = live;
            live = false; // enabled for exactly the first pass
            return was;
          };
        })(),
      }),
    );
    await listener.start();
    expect(markets).toHaveLength(1);
    expect(markets[0]?.commodities.map((c) => c.commodityId)).toEqual(["painite", "platinum"]);
  });

  it("drops a malformed (non-zlib) frame with telemetry, recording nothing", async () => {
    const { markets, sink } = collectingSink();
    const warn = vi.fn();
    const logger = {
      ...nullLogger,
      warn: (msg: string) => {
        warn(msg);
      },
    };
    let live = true;
    const listener = createEddnListener(
      baseDeps({
        source: fakeSource([
          [{ kind: "frame", frame: new Uint8Array([9, 9, 9]) }, { kind: "closed" }],
        ]),
        sink,
        logger,
        isEnabled: () => {
          const was = live;
          live = false;
          return was;
        },
      }),
    );
    await listener.start();
    expect(markets).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith("eddn.decode-drop");
  });

  it("drops a wrong-schema frame (recording nothing)", async () => {
    const { markets, sink } = collectingSink();
    let live = true;
    const listener = createEddnListener(
      baseDeps({
        source: fakeSource([
          [{ kind: "frame", frame: frameOf(EDDN_WRONG_SCHEMA) }, { kind: "closed" }],
        ]),
        sink,
        isEnabled: () => {
          const was = live;
          live = false;
          return was;
        },
      }),
    );
    await listener.start();
    expect(markets).toHaveLength(0);
  });

  it("bounds ingestion volume — drops frames over the rate window", async () => {
    const { markets, sink } = collectingSink();
    let live = true;
    const listener = createEddnListener(
      baseDeps({
        source: fakeSource([
          [
            { kind: "frame", frame: PAESIA_FRAME },
            { kind: "frame", frame: PAESIA_FRAME }, // second within the same window → dropped
            { kind: "closed" },
          ],
        ]),
        sink,
        rate: { maxPerWindow: 1, windowMs: 100_000 },
        isEnabled: () => {
          const was = live;
          live = false;
          return was;
        },
      }),
    );
    await listener.start();
    expect(markets).toHaveLength(1);
  });
});

describe("createEddnListener — reconnect + kill-switch", () => {
  it("reconnects with backoff after a stream closes, until disabled", async () => {
    const { markets, sink } = collectingSink();
    const sleep = vi.fn(async () => {
      await Promise.resolve();
    });
    let streamCalls = 0;
    let enabled = true;
    const source: EddnSource = {
      stream: () => {
        streamCalls += 1;
        const call = streamCalls;
        return (async function* (): AsyncGenerator<EddnEvent> {
          await Promise.resolve();
          yield { kind: "frame", frame: PAESIA_FRAME };
          if (call >= 2) enabled = false; // stop after the second session
          yield { kind: "closed" };
        })();
      },
    };
    const listener = createEddnListener(
      baseDeps({ source, sink, sleep, isEnabled: () => enabled }),
    );
    await listener.start();
    expect(streamCalls).toBe(2); // reconnected once
    expect(sleep).toHaveBeenCalled(); // backed off between sessions
    expect(markets).toHaveLength(2);
  });

  it("resets the rate window once it elapses, admitting a later frame", async () => {
    const { markets, sink } = collectingSink();
    let t = 0;
    let live = true;
    const listener = createEddnListener(
      baseDeps({
        source: fakeSource([
          [
            { kind: "frame", frame: PAESIA_FRAME },
            { kind: "frame", frame: PAESIA_FRAME },
            { kind: "closed" },
          ],
        ]),
        sink,
        rate: { maxPerWindow: 1, windowMs: 1000 },
        now: () => {
          const v = t;
          t += 2000; // each frame lands in a fresh window
          return v;
        },
        isEnabled: () => {
          const was = live;
          live = false;
          return was;
        },
      }),
    );
    await listener.start();
    expect(markets).toHaveLength(2); // both admitted — window reset between them
  });

  it("catches a stream error and logs telemetry rather than crashing", async () => {
    const warn = vi.fn();
    let live = true;
    const listener = createEddnListener(
      baseDeps({
        source: {
          stream: () =>
            (async function* (): AsyncGenerator<EddnEvent> {
              await Promise.resolve();
              throw new Error("socket boom");
            })(),
        },
        logger: {
          ...nullLogger,
          warn: (msg: string) => {
            warn(msg);
          },
        },
        isEnabled: () => {
          const was = live;
          live = false;
          return was;
        },
      }),
    );
    await listener.start();
    expect(warn).toHaveBeenCalledWith("eddn.stream-error");
  });

  it("honours the kill-switch: disabled → never connects", async () => {
    const { markets, sink } = collectingSink();
    const source = fakeSource([[{ kind: "frame", frame: PAESIA_FRAME }]]);
    const streamSpy = vi.spyOn(source, "stream");
    const listener = createEddnListener(baseDeps({ source, sink, isEnabled: () => false }));
    await listener.start();
    expect(streamSpy).not.toHaveBeenCalled();
    expect(markets).toHaveLength(0);
  });

  it("stop() ends the loop (no reconnect)", async () => {
    const ref: { stop: () => void } = { stop: () => undefined };
    let calls = 0;
    const source: EddnSource = {
      stream: () => {
        calls += 1;
        return (async function* (): AsyncGenerator<EddnEvent> {
          await Promise.resolve();
          ref.stop(); // stop mid-session
          yield { kind: "closed" };
        })();
      },
    };
    const listener = createEddnListener(baseDeps({ source, isEnabled: () => true }));
    ref.stop = listener.stop;
    await listener.start();
    expect(calls).toBe(1); // stopped after the first session — never reconnected
  });
});
