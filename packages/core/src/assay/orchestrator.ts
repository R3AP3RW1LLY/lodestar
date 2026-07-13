/**
 * Assay orchestrator (SSOT Step 2.6). The runtime glue that makes Assay real: it
 * subscribes to the live prospect stream on the event bus, runs the PURE verdict
 * engine (Layer 1, `@lodestar/intelligence`) with the merged thresholds + the live
 * price book (2.5), persists the verdict + structured reasons onto the prospect
 * row, publishes the `verdict` event (the main process forwards it to IPC/WS with
 * its renderer consumer — the Assay UI panel, 2.9), hands the callout to the speech
 * queue (Piper TTS, 2.7, once present), and computes the ACTED-ON flag.
 *
 * Legal under §3.2: `core` may import `intelligence`. The verdict math stays pure
 * and deterministic in Layer 1 — this module only wires I/O (bus, DB, price book)
 * around it. GREEN zone: read-only journal consumption + analysis, no game input.
 *
 * Acted-on window: journals carry NO asteroid identity, so "did the commander act
 * on this rock?" is a TEMPORAL correlation, not an identity match. A MINE verdict
 * opens a window on the just-prospected rock (eligible commodities = the ones the
 * callout named); a `MiningRefined` of one of those commodities (or an
 * `AsteroidCracked`, for deep-core) while the window is open marks the prospect
 * acted-on. The window closes when the NEXT prospect supersedes it — the natural
 * mining cadence, so no wall clock is needed and the correlation is deterministic.
 * A SKIP opens no window (an ignored rock is never acted-on).
 *
 * The bus DETACHES a subscriber that throws (event-bus.ts), which would silently
 * kill the pipeline — so every handler is fully error-isolated and never throws;
 * a bad prospect is logged and the next one still assays.
 */

import { nullLogger } from "@lodestar/shared";
import type { Logger, MiningMethod } from "@lodestar/shared";
import { assay, mergeThresholds } from "@lodestar/intelligence";
import type { Reason } from "@lodestar/intelligence";
import type { EventBus } from "../bus/event-bus.js";
import type { Prospect } from "../journal/events/prospected-asteroid.js";
import type { ProspectRepository } from "../session/prospect-repository.js";
import type { ThresholdOverridesStore } from "../settings/threshold-overrides.js";
import type { PriceResolver } from "../market/price-book.js";

/** A prospect observed live, with the mining context needed to assay it. */
export interface ProspectedEvent {
  readonly prospect: Prospect;
  readonly sessionId: number | undefined;
  readonly method: MiningMethod;
}

/** A refined tonne of ore (`MiningRefined`) — drives the acted-on correlation. */
export interface RefinedEvent {
  /** Canonical commodity id (Step 2.2). */
  readonly commodityId: string;
  readonly sessionId: number | undefined;
}

/** An asteroid cracked (`AsteroidCracked`, deep-core) — acted-on + crack linkage. */
export interface CrackedEvent {
  readonly sessionId: number | undefined;
}

/** The Assay verdict for a prospect, published on the bus (forwarded to IPC/WS by the wiring). */
export interface AssayVerdict {
  readonly prospectId: number;
  readonly sessionId: number | undefined;
  readonly call: "MINE" | "SKIP";
  /** Price-weighted expected value per ton — higher is better (ranking). */
  readonly score: number;
  readonly reasons: readonly Reason[];
  readonly method: MiningMethod;
  /** The prospect's own observation timestamp (age-honest). */
  readonly timestamp: string;
}

/** The bus channels the Assay pipeline consumes (`prospected`/`refined`/`cracked`) and produces (`verdict`). */
export interface AssayEvents {
  readonly prospected: ProspectedEvent;
  readonly refined: RefinedEvent;
  readonly cracked: CrackedEvent;
  readonly verdict: AssayVerdict;
}

export interface AssayOrchestratorOptions {
  readonly bus: EventBus<AssayEvents>;
  readonly prospects: ProspectRepository;
  /** Validated per-commodity×method overrides; merged over the pure defaults each prospect. */
  readonly overrides: ThresholdOverridesStore;
  /** Best-known sell price per commodity (the live 2.5 price book resolver). */
  readonly priceBook: PriceResolver;
  readonly logger?: Logger;
  /** Speech callout hook — the Piper speech queue (2.7) subscribes here once present. */
  readonly speak?: (verdict: AssayVerdict) => void;
}

export interface AssayOrchestrator {
  /** Unsubscribe from the bus (ordered shutdown). */
  readonly dispose: () => void;
}

/** The commodities that "acting on" a MINE verdict means — the ones the callout named. */
function mineCommodityIds(reasons: readonly Reason[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const r of reasons) {
    if (r.code === "motherlode" || r.code === "proportion-above-threshold") ids.add(r.commodityId);
  }
  return ids;
}

/** No session (undefined) only matches no session — never bleeds across sessions. */
function sameSession(a: number | undefined, b: number | undefined): boolean {
  return a === b;
}

export function createAssayOrchestrator(opts: AssayOrchestratorOptions): AssayOrchestrator {
  const { bus, prospects, overrides, priceBook } = opts;
  const logger = opts.logger ?? nullLogger;

  // The currently-open prospect: the most-recently-prospected rock still eligible
  // for the acted-on correlation, or undefined (no MINE rock is open).
  let open:
    | {
        readonly id: number;
        readonly sessionId: number | undefined;
        readonly commodityIds: ReadonlySet<string>;
      }
    | undefined;

  const onProspected = (evt: ProspectedEvent): void => {
    try {
      const id = prospects.save(evt.prospect, evt.sessionId);
      // A new prospect supersedes the previous acted-on window IMMEDIATELY — even if
      // the fallible verdict work below throws, the superseded rock must not stay
      // eligible (a later refine would misattribute to it). A MINE re-opens the
      // window on success; a SKIP leaves nothing open.
      open = undefined;
      // Overrides are read per prospect so a live threshold change takes effect
      // without restarting; the pure engine does the rest.
      const thresholds = mergeThresholds(overrides.list());
      const verdict = assay(evt.prospect, evt.method, thresholds, priceBook);
      prospects.saveVerdict(id, verdict.call, JSON.stringify(verdict.reasons));
      if (verdict.call === "MINE") {
        open = { id, sessionId: evt.sessionId, commodityIds: mineCommodityIds(verdict.reasons) };
      }

      const emitted: AssayVerdict = {
        prospectId: id,
        sessionId: evt.sessionId,
        call: verdict.call,
        score: verdict.score,
        reasons: verdict.reasons,
        method: evt.method,
        timestamp: evt.prospect.timestamp,
      };
      opts.speak?.(emitted);
      // Re-entrant publish is queued + drained FIFO by the bus — safe from here.
      bus.publish("verdict", emitted);
    } catch (error) {
      logger.error("assay.prospected-failed", { error: String(error) });
    }
  };

  const onRefined = (evt: RefinedEvent): void => {
    try {
      // Correlates only canonical-resolvable commodities: `RefinedEvent.commodityId`
      // is a canonical id (2.2) matched against the called commodities. An unknown
      // motherlode ore can't produce a resolvable refine anyway — it's covered by
      // the crack path below.
      if (open === undefined) return;
      if (!sameSession(open.sessionId, evt.sessionId)) return;
      if (!open.commodityIds.has(evt.commodityId)) return;
      prospects.markActedOn(open.id); // idempotent — repeated refines don't double-count
    } catch (error) {
      logger.error("assay.refined-failed", { error: String(error) });
    }
  };

  const onCracked = (evt: CrackedEvent): void => {
    try {
      // A crack acts on the currently-open (deep-core MINE) rock — both acted-on and
      // the cracked flag land on THAT specific prospect. Journals carry NO asteroid
      // identity, so with no open rock there's nothing to attribute the crack to (we
      // never fall back to "most recent", which could pollute an intervening SKIP).
      if (open === undefined || !sameSession(open.sessionId, evt.sessionId)) return;
      prospects.markActedOn(open.id);
      prospects.markCracked(open.id);
    } catch (error) {
      logger.error("assay.cracked-failed", { error: String(error) });
    }
  };

  const subs = [
    bus.subscribe("prospected", onProspected),
    bus.subscribe("refined", onRefined),
    bus.subscribe("cracked", onCracked),
  ];

  return {
    dispose: () => {
      for (const s of subs) s.unsubscribe();
    },
  };
}
