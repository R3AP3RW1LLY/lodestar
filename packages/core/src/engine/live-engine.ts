/**
 * Live ingestion engine (SSOT Step 1.9 / 1.9a). The runtime assembler that turns
 * filesystem journal activity into a live `RootState` + `SessionSummary` stream:
 *
 *   JournalWatcher → parse (§5.1 journal + §5.2 live files) → reduce (RootState)
 *                  → advance (session tracker) → persist → notify subscribers.
 *
 * All I/O is injected (the watcher's `fs`/`makeTailer`, an optional repository and
 * cursor store), so the whole pipeline is driven deterministically via `tick()`.
 *
 * Restart resume (1.9a): the engine owns the poll loop and persists the tailer
 * byte position after each tick; on construction it reloads the active session
 * (`loadActive`) and resumes the journal from the saved cursor, so a CLEAN restart
 * never re-folds already-consumed lines into duplicate/orphan rows. The cursor is
 * a best-effort file (not transactional with the DB): a hard crash mid-tick can
 * leave it lagging the last batch, and if the cursor is lost while an active
 * session exists the journal starts at its current end (`resumeAtEnd`) rather than
 * re-folding — bounded exactly-once (cursor inside the DB transaction) is a future
 * hardening. Transient Context (docked/stationType/soldSomething/cargo) is NOT
 * persisted: it resets on resume and is re-established by subsequent live events,
 * so e.g. a carrier sell in the brief window after restart-while-docked can be
 * miscounted as income until the next Docked/Status event.
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
import { advance, initialTracker, resumeTracker, summarize } from "../session/tracker.js";
import type { Session, TrackerState } from "../session/tracker.js";
import type { SessionRepository } from "../session/repository.js";
import { JournalWatcher } from "../journal/watcher.js";
import type {
  JournalCursor,
  TailerLike,
  WatcherEvent,
  WatcherFs,
  WatcherLogger,
} from "../journal/watcher.js";

/** Persists the journal read position so a restart resumes without re-folding (1.9a). */
export interface JournalCursorStore {
  load(): JournalCursor | undefined;
  save(cursor: JournalCursor): void;
}

export interface LiveEngineOptions {
  readonly dir: string;
  readonly fs?: WatcherFs;
  readonly makeTailer?: (name: string, path: string, startOffset: number) => TailerLike;
  readonly pollIntervalMs?: number;
  /** Persist sessions as they change; omit for a pure in-memory engine (tests). */
  readonly repository?: SessionRepository;
  /** Persist/restore the journal read position across restarts (1.9a). */
  readonly cursorStore?: JournalCursorStore;
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

  // Restart resume (1.9a): load the saved journal cursor so the watcher resumes
  // the current file past already-consumed lines, and reload the active session's
  // totals so continued mining updates that row instead of inserting a new one. If
  // an active session exists but the (best-effort) cursor was lost, start the
  // journal at its current end rather than re-folding it onto the resumed session.
  const cursor = opts.cursorStore?.load();
  const resumed = repo?.loadActive();
  const watcher = new JournalWatcher({
    dir: opts.dir,
    emit: ingest,
    logger: watcherLogger,
    ...(opts.fs !== undefined ? { fs: opts.fs } : {}),
    ...(opts.makeTailer !== undefined ? { makeTailer: opts.makeTailer } : {}),
    ...(opts.pollIntervalMs !== undefined ? { pollIntervalMs: opts.pollIntervalMs } : {}),
    ...(cursor !== undefined ? { resumeCursor: cursor } : {}),
    ...(resumed !== undefined && cursor === undefined ? { resumeAtEnd: true } : {}),
  });

  if (resumed !== undefined) {
    tracker = resumeTracker(resumed.session);
    activeId = resumed.id;
    lastSession = resumed.session;
    sessionSummary = summarize(resumed.session, opts.now?.());
  }

  // The engine owns the poll loop so it can persist the cursor after each tick's
  // batch is fully processed (a line boundary — safe to resume from).
  let lastCursor: JournalCursor | undefined = cursor;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  function saveCursor(): void {
    const pos = watcher.activePosition();
    if (pos === undefined) return;
    if (
      lastCursor !== undefined &&
      lastCursor.file === pos.file &&
      lastCursor.offset === pos.offset
    )
      return;
    lastCursor = pos;
    opts.cursorStore?.save(pos);
  }

  function pollOnce(): void {
    watcher.tick();
    saveCursor();
  }

  return {
    start: () => {
      pollOnce();
      pollTimer = setInterval(pollOnce, opts.pollIntervalMs ?? 100);
      pollTimer.unref();
    },
    stop: () => {
      if (pollTimer !== undefined) clearInterval(pollTimer);
      pollTimer = undefined;
    },
    tick: () => {
      pollOnce();
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
