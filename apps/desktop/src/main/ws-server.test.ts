import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { envelope, initialRootState } from "@lodestar/shared";
import type { Envelope } from "@lodestar/shared";
import { createWsPushServer } from "./ws-server.js";
import type { WsPushServer } from "./ws-server.js";

const TOKEN = "test-token-6f3a9c1e8b2d4f7a0c5e9d1b3a6f8c2e";

let server: WsPushServer | undefined;
const clients: WebSocket[] = [];

afterEach(async () => {
  for (const c of clients) c.terminate();
  clients.length = 0;
  await server?.close();
  server = undefined;
});

function connect(port: number, protocols: string[]): WebSocket {
  const ws = new WebSocket(`ws://127.0.0.1:${String(port)}`, protocols);
  clients.push(ws);
  return ws;
}

/** Resolves "open" if the handshake succeeds, "rejected" if it is refused. */
function handshake(ws: WebSocket): Promise<"open" | "rejected"> {
  return new Promise((resolve) => {
    ws.on("open", () => {
      resolve("open");
    });
    ws.on("error", () => {
      resolve("rejected");
    });
    ws.on("unexpected-response", () => {
      resolve("rejected");
    });
  });
}

function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.on("message", (data: Buffer) => {
      resolve(JSON.parse(data.toString("utf8")));
    });
  });
}

describe("createWsPushServer", () => {
  it("binds an ephemeral loopback port", async () => {
    server = await createWsPushServer({ token: TOKEN });
    expect(server.port).toBeGreaterThan(0);
  });

  it("accepts a client offering the token and delivers a broadcast envelope", async () => {
    server = await createWsPushServer({ token: TOKEN });
    const ws = connect(server.port, [TOKEN]);
    expect(await handshake(ws)).toBe("open");

    const received = nextMessage(ws);
    const env: Envelope = envelope("session.stats", null);
    server.broadcast(env);
    expect(await received).toMatchObject({ v: 1, channel: "session.stats", payload: null });
  });

  it("rejects a client with a wrong token", async () => {
    server = await createWsPushServer({ token: TOKEN });
    const ws = connect(server.port, ["wrong-token"]);
    expect(await handshake(ws)).toBe("rejected");
    expect(server.clientCount).toBe(0);
  });

  it("rejects a client that offers no subprotocol at all", async () => {
    server = await createWsPushServer({ token: TOKEN });
    const ws = connect(server.port, []);
    expect(await handshake(ws)).toBe("rejected");
  });

  it("broadcasts to multiple authorized clients", async () => {
    server = await createWsPushServer({ token: TOKEN });
    const a = connect(server.port, [TOKEN]);
    const b = connect(server.port, [TOKEN]);
    expect(await handshake(a)).toBe("open");
    expect(await handshake(b)).toBe("open");

    const gotA = nextMessage(a);
    const gotB = nextMessage(b);
    server.broadcast(envelope("state.delta", { activity: "mining" }));
    expect(await gotA).toMatchObject({ channel: "state.delta", payload: { activity: "mining" } });
    expect(await gotB).toMatchObject({ channel: "state.delta", payload: { activity: "mining" } });
  });

  it("never logs the token", async () => {
    const logs: string[] = [];
    const record = (msg: string, fields?: Record<string, unknown>): void => {
      logs.push(msg + " " + JSON.stringify(fields ?? {}));
    };
    server = await createWsPushServer({
      token: TOKEN,
      logger: { info: record, warn: record },
    });
    const ws = connect(server.port, [TOKEN]);
    await handshake(ws);
    server.broadcast(envelope("session.stats", null));
    expect(logs.join("\n")).not.toContain(TOKEN);
    expect(logs.some((l) => l.startsWith("ws.listening"))).toBe(true);
  });

  it("primes a newly-connected client with the onConnect envelopes before any broadcast", async () => {
    const snapshot = envelope("state.snapshot", initialRootState());
    server = await createWsPushServer({ token: TOKEN, onConnect: () => [snapshot] });
    const ws = connect(server.port, [TOKEN]);
    // Attach the message listener synchronously (before any await) so the primer,
    // which the server sends the instant the connection opens, is never missed.
    const first = nextMessage(ws);
    expect(await handshake(ws)).toBe("open");
    expect(await first).toMatchObject({ channel: "state.snapshot" });
  });

  it("survives an onConnect that throws (one bad connect never wedges the server)", async () => {
    const logs: string[] = [];
    server = await createWsPushServer({
      token: TOKEN,
      logger: { info: () => {}, warn: (m) => logs.push(m) },
      onConnect: () => {
        throw new Error("boom");
      },
    });
    const ws = connect(server.port, [TOKEN]);
    expect(await handshake(ws)).toBe("open");
    // Handshake still succeeds and a subsequent broadcast is still delivered.
    const got = nextMessage(ws);
    server.broadcast(envelope("session.stats", null));
    expect(await got).toMatchObject({ channel: "session.stats" });
    expect(logs).toContain("ws.onconnect-failed");
  });

  it("binds a requested explicit port when one is provided", async () => {
    const probe = await createWsPushServer({ token: TOKEN });
    const port = probe.port;
    await probe.close(); // free it (no active connections → immediately reusable)
    server = await createWsPushServer({ token: TOKEN, port });
    expect(server.port).toBe(port);
  });

  it("close() stops accepting new connections", async () => {
    server = await createWsPushServer({ token: TOKEN });
    const port = server.port;
    await server.close();
    server = undefined;
    const ws = connect(port, [TOKEN]);
    expect(await handshake(ws)).toBe("rejected");
  });
});
