/**
 * The overlay's loopback WebSocket client (SSOT Step 2.10 / §5.4). This is the
 * SOLE sanctioned browser-WebSocket consumer in the app: it connects ONLY to our
 * own 127.0.0.1 push server, presenting the per-launch token as the WebSocket
 * subprotocol (§5.6) — never a query param. It is push-only: it never sends a
 * frame, only receives §5.6 Envelopes. Auto-reconnects if the link drops (the main
 * app may still be starting, or the overlay outlived a transient close).
 *
 * The `WebSocket` construction is isolated here and nowhere else, so the egress
 * firewall (eslint + compliance) sanctions exactly one file. The socket factory is
 * injectable purely so tests can drive the reconnect/dispatch logic deterministically
 * without a real network.
 */

import { isEnvelope } from "@lodestar/shared";
import type { EnvelopeShape } from "@lodestar/shared";

/** The minimal message shape we read off a socket event (browser `MessageEvent`). */
export interface WsMessage {
  readonly data?: unknown;
}

/** The minimal WebSocket surface the client depends on (browser `WebSocket`). */
export interface WsLike {
  addEventListener: (type: string, listener: (ev: WsMessage) => void) => void;
  close: () => void;
}

export type WsFactory = (url: string, protocol: string) => WsLike;

export interface OverlayClientDeps {
  readonly port: number;
  readonly token: string;
  /** Called with each validated inbound envelope (outer shape only; payload per-channel). */
  readonly onEnvelope: (env: EnvelopeShape) => void;
  /** Optional connection-status hook (drives a "link lost" affordance if wanted). */
  readonly onStatus?: (status: "open" | "closed") => void;
  /** Injected in tests; defaults to the real loopback WebSocket. */
  readonly factory?: WsFactory;
  /** Reconnect delay after a drop (ms). */
  readonly reconnectMs?: number;
  /** Injected in tests so reconnect timing is deterministic. */
  readonly setTimer?: (fn: () => void, ms: number) => void;
}

export interface OverlayClient {
  /** Stop the client and prevent any further reconnect. */
  close: () => void;
}

/** Parse a raw socket payload into a validated envelope, or undefined if it isn't one. */
export function parseFrame(data: unknown): EnvelopeShape | undefined {
  if (typeof data !== "string") return undefined;
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    return undefined;
  }
  return isEnvelope(json) ? json : undefined;
}

const defaultFactory: WsFactory = (url, protocol) => new WebSocket(url, protocol);

export function connectOverlay(deps: OverlayClientDeps): OverlayClient {
  const factory = deps.factory ?? defaultFactory;
  const reconnectMs = deps.reconnectMs ?? 1000;
  const setTimer = deps.setTimer ?? ((fn, ms) => void setTimeout(fn, ms));
  const url = `ws://127.0.0.1:${String(deps.port)}`;

  let stopped = false;
  let socket: WsLike | undefined;

  const open = (): void => {
    if (stopped) return;
    const ws = factory(url, deps.token);
    socket = ws;
    ws.addEventListener("open", () => {
      deps.onStatus?.("open");
    });
    ws.addEventListener("message", (ev) => {
      const env = parseFrame(ev.data);
      if (env !== undefined) deps.onEnvelope(env);
    });
    ws.addEventListener("close", () => {
      deps.onStatus?.("closed");
      // A transient close (main restarting) or an early connect before the server
      // is up: retry after a delay, unless the overlay was deliberately closed.
      if (!stopped) setTimer(open, reconnectMs);
    });
  };

  open();

  return {
    close: () => {
      stopped = true;
      socket?.close();
    },
  };
}
