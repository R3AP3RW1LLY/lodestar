/**
 * Session persistence (SSOT Step 1.8 + resume wiring in 1.9a). Writes the session
 * row + append-only session_events + per-ton refinements, and reconstructs an
 * active session on app restart. Restart model: a session's authoritative TOTALS
 * are reloaded verbatim from the persisted row and the engine resumes the journal
 * past already-consumed lines (Step 1.9a cursor), so a CLEAN restart doesn't
 * re-fold. Transient end-detection state resets on resume: `cargoByCommodity` is
 * re-established by the next Cargo event, but `soldSomething` only by the next
 * MarketSell — so a session already sold to zero right before a restart won't
 * cargo-zero-end until a later sell or the 20-min idle timeout. Only the user's
 * own local data.
 */

import type { Db } from "@lodestar/data";
import type { SessionSummary } from "@lodestar/shared";
import type { LoggedEvent, Refinement, Session } from "./tracker.js";
import { summarize } from "./tracker.js";

interface SessionRow {
  readonly id: number;
  readonly started_at: string;
  readonly ended_at: string | null;
  readonly cmdr: string | null;
  readonly ship: string | null;
  readonly system: string | null;
  readonly body: string | null;
  readonly ring: string | null;
  readonly tons_refined: number;
  readonly credits_earned: number;
  readonly limpets_launched: number;
}

export interface SessionRepository {
  /** Insert (id omitted) or update the session, appending any not-yet-persisted events/refinements. Returns the row id. */
  save(session: Session, id?: number): number;
  /** The most recent still-active session, rebuilt for resume, or undefined. */
  loadActive(): { id: number; session: Session } | undefined;
  /** Ended sessions, newest first (for history/display). */
  listEnded(limit?: number): SessionSummary[];
}

export function createSessionRepository(db: Db): SessionRepository {
  const insertSession = db.prepare(
    `INSERT INTO sessions (started_at, ended_at, cmdr, ship, system, body, ring,
       tons_refined, credits_earned, limpets_launched, status)
     VALUES (@startedAt, @endedAt, @cmdr, @ship, @system, @body, @ring,
       @tonsRefined, @creditsEarned, @limpetsLaunched, @status)`,
  );
  const updateSession = db.prepare(
    `UPDATE sessions SET ended_at=@endedAt, cmdr=@cmdr, ship=@ship, system=@system, body=@body,
       ring=@ring, tons_refined=@tonsRefined, credits_earned=@creditsEarned,
       limpets_launched=@limpetsLaunched, status=@status WHERE id=@id`,
  );
  const countEvents = db.prepare("SELECT COUNT(*) AS n FROM session_events WHERE session_id = ?");
  const insertEvent = db.prepare(
    "INSERT INTO session_events (session_id, seq, timestamp, event_type, payload) VALUES (?, ?, ?, ?, ?)",
  );
  const countRefinements = db.prepare("SELECT COUNT(*) AS n FROM refinements WHERE session_id = ?");
  const insertRefinement = db.prepare(
    "INSERT INTO refinements (session_id, timestamp, commodity, tons) VALUES (?, ?, ?, ?)",
  );

  function rowParams(session: Session, id?: number): Record<string, unknown> {
    return {
      ...(id !== undefined ? { id } : {}),
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? null,
      cmdr: session.cmdr ?? null,
      ship: session.ship ?? null,
      system: session.system ?? null,
      body: session.body ?? null,
      ring: session.ring ?? null,
      tonsRefined: session.tonsRefined,
      creditsEarned: session.creditsEarned,
      limpetsLaunched: session.limpetsLaunched,
      status: session.endedAt !== undefined ? "ended" : "active",
    };
  }

  const save = db.transaction((session: Session, id?: number): number => {
    let sid = id;
    if (sid === undefined) {
      sid = Number(insertSession.run(rowParams(session)).lastInsertRowid);
    } else {
      updateSession.run(rowParams(session, sid));
    }
    const persistedEvents = (countEvents.get(sid) as { n: number }).n;
    session.events.slice(persistedEvents).forEach((ev, i) => {
      insertEvent.run(sid, persistedEvents + i, ev.timestamp, ev.eventType, ev.payload);
    });
    const persistedRefs = (countRefinements.get(sid) as { n: number }).n;
    for (const r of session.refinements.slice(persistedRefs)) {
      insertRefinement.run(sid, r.timestamp, r.commodity, r.tons);
    }
    return sid;
  });

  function rebuild(row: SessionRow): Session {
    // Reload the full append-only history so `save`'s slice-by-count stays exact
    // and idempotent after a restart. Totals come from the row verbatim (never
    // re-folded). Transient end-detection state resets here: cargoByCommodity is
    // re-established by the next Cargo event, soldSomething only by the next sell.
    const refinements = db
      .prepare(
        "SELECT timestamp, commodity, tons FROM refinements WHERE session_id = ? ORDER BY id",
      )
      .all(row.id) as Refinement[];
    const events = db
      .prepare(
        "SELECT timestamp, event_type AS eventType, payload FROM session_events WHERE session_id = ? ORDER BY seq",
      )
      .all(row.id) as LoggedEvent[];
    const commodities = [...new Set(refinements.map((r) => r.commodity))];
    // Last activity spans every mining signal (refine, drone launch, prospect,
    // crack) — not just refinements — so a resumed session's idle-timeout clock is
    // accurate. A MarketSell is a sale, not mining activity, so it doesn't count.
    const lastActivityAt =
      events.filter((ev) => ev.eventType !== "MarketSell").at(-1)?.timestamp ?? row.started_at;
    return {
      startedAt: row.started_at,
      lastActivityAt,
      ...(row.ended_at !== null ? { endedAt: row.ended_at } : {}),
      ...(row.cmdr !== null ? { cmdr: row.cmdr } : {}),
      ...(row.ship !== null ? { ship: row.ship } : {}),
      ...(row.system !== null ? { system: row.system } : {}),
      ...(row.body !== null ? { body: row.body } : {}),
      ...(row.ring !== null ? { ring: row.ring } : {}),
      tonsRefined: row.tons_refined,
      creditsEarned: row.credits_earned,
      bankedToCarrier: 0,
      limpetsLaunched: row.limpets_launched,
      commodities,
      cargoByCommodity: {},
      soldSomething: false,
      refinements,
      events,
    };
  }

  return {
    save: (session, id) => save(session, id),
    loadActive: () => {
      const row = db
        .prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY id DESC LIMIT 1")
        .get() as SessionRow | undefined;
      return row === undefined ? undefined : { id: row.id, session: rebuild(row) };
    },
    listEnded: (limit = 50) =>
      (
        db
          .prepare("SELECT * FROM sessions WHERE status = 'ended' ORDER BY id DESC LIMIT ?")
          .all(limit) as SessionRow[]
      ).map((row) => summarize(rebuild({ ...row, ended_at: row.ended_at }))),
  };
}
