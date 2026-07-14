/**
 * EDDN listener (SSOT Step 4.8). Subscribes to the EDDN firehose, zlib-inflates each
 * frame, validates it as a `commodity/3` message, drops malformed/implausible/spoofed
 * data (telemetry-counted), rate-bounds ingestion, and hands accepted markets to an
 * injected sink. Reconnects with jittered backoff and honours a kill-switch.
 *
 * The transport is an INJECTED async-iterable `EddnSource` (tested via a test-double publisher);
 * the concrete ZeroMQ SUB adapter to `tcp://eddn.edcd.io:9500` — plus its supply-chain +
 * egress-firewall sanctioning (a sanctioned non-HTTP egress module per §5.4) — is a
 * deliberate operator-facing follow-up, since it adds a native dependency.
 */

import { inflateSync } from "node:zlib";
import type { DomainError, Logger, Result } from "@lodestar/shared";
import { domainError, err, nullLogger, ok } from "@lodestar/shared";
import type { BackoffOptions } from "../gateway/backoff.js";
import { DEFAULT_BACKOFF, backoffDelayMs } from "../gateway/backoff.js";
import type { EddnMarketMessage, PlausibilityBands } from "./commodity-schema.js";
import { DEFAULT_PLAUSIBILITY, parseEddnCommodityMessage } from "./commodity-schema.js";

/** The EDDN relay endpoint (used by the concrete ZeroMQ adapter). */
export const EDDN_ENDPOINT = "tcp://eddn.edcd.io:9500";

export type EddnEvent =
  { readonly kind: "frame"; readonly frame: Uint8Array } | { readonly kind: "closed" };

/** The injected transport: each `stream()` is one connection attempt's event sequence. */
export interface EddnSource {
  stream: () => AsyncIterable<EddnEvent>;
}

export interface EddnSink {
  record: (market: EddnMarketMessage) => void;
}

export interface RateBound {
  readonly maxPerWindow: number;
  readonly windowMs: number;
}

export interface EddnListenerDeps {
  readonly source: EddnSource;
  readonly sink: EddnSink;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now: () => number;
  /** Kill-switch: reconnect + processing stop while this returns false. */
  readonly isEnabled: () => boolean;
  readonly logger?: Logger;
  readonly rand?: () => number;
  readonly backoff?: BackoffOptions;
  readonly rate?: RateBound;
  readonly bands?: PlausibilityBands;
}

export interface EddnListener {
  /** Run the connect→consume→reconnect loop until stopped or disabled. */
  start: () => Promise<void>;
  stop: () => void;
}

/** zlib-inflate an EDDN frame and JSON-parse it (a bad frame → typed error, never throws). */
export function decodeEddnFrame(frame: Uint8Array): Result<unknown, DomainError> {
  let text: string;
  try {
    text = inflateSync(frame).toString("utf8");
  } catch {
    return err(domainError("eddn/inflate", "frame is not valid zlib data"));
  }
  try {
    return ok(JSON.parse(text));
  } catch {
    return err(domainError("eddn/json", "inflated frame is not valid JSON"));
  }
}

export function createEddnListener(deps: EddnListenerDeps): EddnListener {
  const logger = deps.logger ?? nullLogger;
  const rand = deps.rand ?? (() => 0.5);
  const backoff = deps.backoff ?? DEFAULT_BACKOFF;
  const bands = deps.bands ?? DEFAULT_PLAUSIBILITY;
  // Held on an object so the returned `stop()` closure's mutation is visible to the
  // loop's control-flow analysis (a bare `let` would be flagged as an invariant flag).
  const state = { running: false };
  // A function return is opaque to narrowing, so the loop guard isn't seen as invariant
  // (the flag is flipped by the external `stop()` closure).
  const isRunning = (): boolean => state.running;
  let windowStart = 0;
  let windowCount = 0;

  function withinRate(): boolean {
    if (deps.rate === undefined) return true;
    const now = deps.now();
    if (now - windowStart >= deps.rate.windowMs) {
      windowStart = now;
      windowCount = 0;
    }
    if (windowCount >= deps.rate.maxPerWindow) return false;
    windowCount += 1;
    return true;
  }

  function processFrame(frame: Uint8Array): void {
    if (!withinRate()) {
      logger.debug("eddn.rate-drop", {});
      return;
    }
    const decoded = decodeEddnFrame(frame);
    if (!decoded.ok) {
      logger.warn("eddn.decode-drop", { code: decoded.error.code });
      return;
    }
    const parsed = parseEddnCommodityMessage(decoded.value, bands);
    if (!parsed.ok) {
      logger.debug("eddn.schema-drop", { code: parsed.error.code });
      return;
    }
    if (parsed.value.dropped > 0) {
      logger.debug("eddn.rows-dropped", { dropped: parsed.value.dropped });
    }
    if (parsed.value.market.commodities.length > 0) {
      deps.sink.record(parsed.value.market);
    }
  }

  async function consumeOneConnection(): Promise<void> {
    for await (const event of deps.source.stream()) {
      if (!isRunning()) return; // stop() mid-stream; kill-switch enforced at the reconnect guard
      if (event.kind === "closed") return;
      processFrame(event.frame);
    }
  }

  return {
    async start() {
      state.running = true;
      let attempt = 0;
      while (isRunning() && deps.isEnabled()) {
        try {
          await consumeOneConnection();
          attempt = 0; // a clean session resets backoff
        } catch (e) {
          logger.warn("eddn.stream-error", { error: String(e) });
        }
        if (!isRunning() || !deps.isEnabled()) break;
        await deps.sleep(backoffDelayMs(attempt, rand, backoff));
        attempt += 1;
      }
      state.running = false;
    },
    stop() {
      state.running = false;
    },
  };
}
