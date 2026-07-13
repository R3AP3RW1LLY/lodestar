/**
 * Live ingestion engine (SSOT Step 1.9). The runtime assembler that turns
 * filesystem journal activity into a live `RootState` + `SessionSummary` stream:
 *
 *   JournalWatcher → parse (§5.1 journal + §5.2 live files) → reduce (RootState)
 *                  → advance (session tracker) → persist → notify subscribers.
 *
 * All I/O is injected (the watcher's `fs`/`makeTailer`, an optional repository),
 * so the whole pipeline is driven deterministically in tests via `tick()`.
 *
 * PII: subscribers only ever receive `RootState` / `SessionSummary`, whose types
 * carry no raw event payloads — `UnknownJournalEvent.payload` (third-party PII)
 * is folded through `reduce`/`advance`, which ignore it, and never surfaces.
 */

import type { Logger, RootState, SessionSummary, StateInput } from "@lodestar/shared";
import { initialRootState, nullLogger } from "@lodestar/shared";
import { parseJournalEvent } from "../journal/events/parse.js";
import { parseCargo, parseStatus } from "../livefiles/index.js";
import { reduce } from "../state/index.js";
import { advance, initialTracker, summarize } from "../session/tracker.js";
import type { Session, TrackerState } from "../session/tracker.js";
import type { SessionRepository } from "../session/repository.js";
import { JournalWatcher } from "../journal/watcher.js";
import type { TailerLike, WatcherEvent, WatcherFs, WatcherLogger } from "../journal/watcher.js";

export interface LiveEngineOptions {
  readonly dir: string;
  readonly fs?: WatcherFs;
  readonly makeTailer?: (name: string, path: string) => TailerLike;
  readonly pollIntervalMs?: number;
  /** Persist sessions as they change; omit for a pure in-memory engine (tests). */
  readonly repository?: SessionRepository;
  readonly logger?: Logger;
  /** Clock for active-session rate extrapolation; omit for deterministic rates. */
  readonly now?: () => number;
}

export type Unsubscribe = () => void;

export interface LiveEngine {
  start(): void;
  stop(): void;
  /** One deterministic poll cycle (tests drive the pipeline through this). */
  tick(): void;
  state(): RootState;
  session(): SessionSummary | null;
  onState(fn: (state: RootState) => void): Unsubscribe;
  onSession(fn: (session: SessionSummary | null) => void): Unsubscribe;
}

export function createLiveEngine(opts: LiveEngineOptions): LiveEngine {
  const logger = opts.logger ?? nullLogger;
  const repo = opts.repository;
  const stateListeners = new Set<(state: RootState) => void>();
  const sessionListeners = new Set<(session: SessionSummary | null) => void>();

  let rootState: RootState = initialRootState();
  let tracker: TrackerState = initialTracker();
  let activeId: number | undefined;
  let lastSession: Session | undefined;
  let sessionSummary: SessionSummary | null = null;

  const watcherLogger: WatcherLogger = {
    warn: (msg, fields) => {
      logger.warn(msg, fields);
    },
  };

  function emit<T>(listeners: Set<(v: T) => void>, value: T): void {
    for (const fn of listeners) {
      // A throwing subscriber must not detach the others or break ingestion.
      try {
        fn(value);
      } catch (error) {
        logger.error("engine.subscriber-threw", { error: String(error) });
      }
    }
  }

  function toStateInput(event: WatcherEvent): StateInput | undefined {
    if (event.source === "journal") {
      const parsed = parseJournalEvent(event.raw, logger);
      return parsed.ok ? { kind: "journal", event: parsed.value } : undefined;
    }
    if (event.name === "Status.json") {
      const parsed = parseStatus(event.raw);
      return parsed.ok ? { kind: "status", status: parsed.value } : undefined;
    }
    if (event.name === "Cargo.json") {
      const parsed = parseCargo(event.raw);
      return parsed.ok ? { kind: "cargo", cargo: parsed.value } : undefined;
    }
    // Market/NavRoute/ModulesInfo do not feed RootState in Phase 1.
    return undefined;
  }

  function persist(next: TrackerState): void {
    if (repo === undefined) return;
    // A session that just ended IS the one we were persisting under activeId —
    // update its row to 'ended', then clear the id so the next active inserts.
    for (const ended of next.justEnded) {
      repo.save(ended, activeId);
      activeId = undefined;
    }
    if (next.active !== undefined) {
      activeId = repo.save(next.active, activeId);
    }
  }

  function ingest(event: WatcherEvent): void {
    const input = toStateInput(event);
    if (input === undefined) return;
    rootState = reduce(rootState, input);
    tracker = advance(tracker, input);
    persist(tracker);

    const current = tracker.active ?? tracker.justEnded.at(-1) ?? lastSession;
    lastSession = current;
    sessionSummary = current === undefined ? null : summarize(current, opts.now?.());

    emit(stateListeners, rootState);
    emit(sessionListeners, sessionSummary);
  }

  const watcher = new JournalWatcher({
    dir: opts.dir,
    emit: ingest,
    logger: watcherLogger,
    ...(opts.fs !== undefined ? { fs: opts.fs } : {}),
    ...(opts.makeTailer !== undefined ? { makeTailer: opts.makeTailer } : {}),
    ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
  });

  return {
    start: () => {
      watcher.start();
    },
    stop: () => {
      watcher.stop();
    },
    tick: () => {
      watcher.tick();
    },
    state: () => rootState,
    session: () => sessionSummary,
    onState: (fn) => {
      stateListeners.add(fn);
      return () => stateListeners.delete(fn);
    },
    onSession: (fn) => {
      sessionListeners.add(fn);
      return () => sessionListeners.delete(fn);
    },
  };
}
