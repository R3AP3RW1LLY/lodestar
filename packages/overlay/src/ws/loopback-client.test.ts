import { describe, expect, it } from "vitest";
import { envelope } from "@lodestar/shared";
import type { EnvelopeShape } from "@lodestar/shared";
import { connectOverlay, parseFrame } from "./loopback-client.js";
import type { WsFactory, WsLike, WsMessage } from "./loopback-client.js";

interface FakeSocket extends WsLike {
  readonly url: string;
  readonly protocol: string;
  closed: boolean;
  emit: (type: string, ev: WsMessage) => void;
}

function fakeFactory(): { factory: WsFactory; sockets: FakeSocket[] } {
  const sockets: FakeSocket[] = [];
  const factory: WsFactory = (url, protocol) => {
    const listeners = new Map<string, ((ev: WsMessage) => void)[]>();
    const socket: FakeSocket = {
      url,
      protocol,
      closed: false,
      addEventListener: (type, listener) => {
        const arr = listeners.get(type) ?? [];
        arr.push(listener);
        listeners.set(type, arr);
      },
      close: () => {
        socket.closed = true;
      },
      emit: (type, ev) => {
        for (const l of listeners.get(type) ?? []) l(ev);
      },
    };
    sockets.push(socket);
    return socket;
  };
  return { factory, sockets };
}

const TOKEN = "tok-6f3a9c1e8b2d4f7a";

describe("parseFrame", () => {
  it("returns a validated envelope for a well-formed frame", () => {
    const frame = JSON.stringify(envelope("session.stats", null));
    expect(parseFrame(frame)?.channel).toBe("session.stats");
  });

  it("returns undefined for non-string, non-JSON, and non-envelope frames", () => {
    expect(parseFrame(42)).toBeUndefined();
    expect(parseFrame("{not json")).toBeUndefined();
    expect(parseFrame(JSON.stringify({ hello: "world" }))).toBeUndefined();
  });
});

describe("connectOverlay", () => {
  it("connects to the loopback port with the token as the subprotocol", () => {
    const { factory, sockets } = fakeFactory();
    connectOverlay({ port: 5555, token: TOKEN, onEnvelope: () => {}, factory });
    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe("ws://127.0.0.1:5555");
    expect(sockets[0]?.protocol).toBe(TOKEN);
  });

  it("delivers validated envelopes and drops malformed frames", () => {
    const { factory, sockets } = fakeFactory();
    const seen: EnvelopeShape[] = [];
    connectOverlay({ port: 1, token: TOKEN, onEnvelope: (e) => seen.push(e), factory });
    const sock = sockets[0];
    // parseFrame validates only the OUTER envelope shape, so a raw well-formed
    // envelope with an arbitrary payload is enough to exercise dispatch.
    const frame = { v: 1, ts: "t", channel: "assay.verdict", payload: { call: "MINE" } };
    sock?.emit("message", { data: JSON.stringify(frame) });
    sock?.emit("message", { data: "garbage" }); // dropped
    sock?.emit("message", { data: 99 }); // dropped
    expect(seen).toHaveLength(1);
    expect(seen[0]?.channel).toBe("assay.verdict");
  });

  it("reports open/closed status", () => {
    const { factory, sockets } = fakeFactory();
    const status: string[] = [];
    connectOverlay({
      port: 1,
      token: TOKEN,
      onEnvelope: () => {},
      onStatus: (s) => status.push(s),
      factory,
      setTimer: () => {},
    });
    sockets[0]?.emit("open", {});
    sockets[0]?.emit("close", {});
    expect(status).toEqual(["open", "closed"]);
  });

  it("reconnects after a drop", () => {
    const { factory, sockets } = fakeFactory();
    const timers: (() => void)[] = [];
    connectOverlay({
      port: 1,
      token: TOKEN,
      onEnvelope: () => {},
      factory,
      setTimer: (fn) => timers.push(fn),
    });
    sockets[0]?.emit("close", {});
    expect(timers).toHaveLength(1); // a reconnect was scheduled
    timers[0]?.(); // fire it
    expect(sockets).toHaveLength(2); // a fresh socket opened
  });

  it("close() stops the client and prevents any reconnect", () => {
    const { factory, sockets } = fakeFactory();
    const timers: (() => void)[] = [];
    const client = connectOverlay({
      port: 1,
      token: TOKEN,
      onEnvelope: () => {},
      factory,
      setTimer: (fn) => timers.push(fn),
    });
    client.close();
    expect(sockets[0]?.closed).toBe(true);
    sockets[0]?.emit("close", {}); // a late close event must NOT reconnect
    expect(timers).toHaveLength(0);
    expect(sockets).toHaveLength(1);
  });
});
