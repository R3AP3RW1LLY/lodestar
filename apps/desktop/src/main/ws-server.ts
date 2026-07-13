/**
 * Localhost WebSocket push server (SSOT §5.6 / Step 1.9). Aux windows — the
 * overlay from Step 2.10 — subscribe here for push-only telemetry. Hard rules:
 *  - binds LOOPBACK only (127.0.0.1), on an OS-assigned ephemeral port;
 *  - authenticates with a high-entropy per-launch token carried in the
 *    `Sec-WebSocket-Protocol` subprotocol — never a query param, never logged;
 *  - every frame is a §5.6 Envelope, JSON-encoded; the server only ever pushes.
 * Lifecycle is owned by the app main (start before any subscriber window; the
 * returned handle's `close()` is called on shutdown).
 */

import { WebSocketServer } from "ws";
import { timingSafeEqual } from "node:crypto";
import type { Envelope } from "@lodestar/shared";

const LOOPBACK = "127.0.0.1";

/** Constant-time token check (length is not secret; the 256-bit value is). */
function tokenMatches(offered: readonly string[], token: string): boolean {
  const expected = Buffer.from(token, "utf8");
  return offered.some((candidate) => {
    const got = Buffer.from(candidate, "utf8");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export interface WsServerLogger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
}

export interface WsServerDeps {
  /** High-entropy per-launch token the client must present as its subprotocol. */
  readonly token: string;
  readonly port?: number;
  readonly logger?: WsServerLogger;
}

export interface WsPushServer {
  /** The actual bound loopback port (ephemeral unless one was requested). */
  readonly port: number;
  /** Push an envelope to every currently-connected authorized client. */
  broadcast: (env: Envelope) => void;
  readonly clientCount: number;
  close: () => Promise<void>;
}

/** The Node upgrade request, typed structurally so we needn't import node:http. */
interface UpgradeInfo {
  readonly req: { readonly headers: Record<string, string | string[] | undefined> };
}

/** The subprotocols a client offered in its `Sec-WebSocket-Protocol` header. */
function offeredProtocols(header: string | string[] | undefined): string[] {
  if (typeof header !== "string") return [];
  return header.split(",").map((s) => s.trim());
}

export function createWsPushServer(deps: WsServerDeps): Promise<WsPushServer> {
  const token = deps.token;

  const wss = new WebSocketServer({
    host: LOOPBACK,
    port: deps.port ?? 0,
    // Gate the handshake: an unauthorized client is refused (HTTP 401), never
    // upgraded. The token is read from the subprotocol header only. `info` is
    // typed structurally so we avoid importing node:http (banned by lint).
    verifyClient: (info: UpgradeInfo) =>
      tokenMatches(offeredProtocols(info.req.headers["sec-websocket-protocol"]), token),
    // Echo the token back as the negotiated subprotocol so the client's offer is
    // accepted; only reachable once verifyClient has already authorized.
    handleProtocols: (protocols: Set<string>) => (protocols.has(token) ? token : false),
  });

  return new Promise<WsPushServer>((resolve, reject) => {
    wss.on("error", reject);
    wss.on("connection", () => {
      deps.logger?.info("ws.client-connected", { clients: wss.clients.size });
    });

    wss.on("listening", () => {
      wss.off("error", reject);
      // A listening TCP server always reports an address object (the string form
      // is Unix-socket only, which we never use).
      const port = (wss.address() as { port: number }).port;
      deps.logger?.info("ws.listening", { host: LOOPBACK, port });

      resolve({
        port,
        get clientCount() {
          return wss.clients.size;
        },
        broadcast: (env: Envelope) => {
          const frame = JSON.stringify(env);
          for (const client of wss.clients) {
            if (client.readyState === client.OPEN) client.send(frame);
          }
        },
        close: () =>
          new Promise<void>((res) => {
            for (const client of wss.clients) client.terminate();
            wss.close(() => {
              res();
            });
          }),
      });
    });
  });
}
