/**
 * Personal bests (SSOT Step 3.4) — the commander's mining records, kept in the
 * `personal_bests` table (migration 005), one row per category. `check(input)`
 * evaluates an ENDED session against the current records inside a single
 * transaction, replaces only the STRICTLY-beaten ones (equalling a record does not
 * replace it), and returns exactly the newly-beaten records — that list IS the
 * `session.newBest` payload the UI celebrates (each new best appears once; a
 * re-check of the same session beats nothing).
 *
 * The value set is supplied by the caller so the comparison stays pure of any
 * price-book/prospect coupling: `sessionBestValues` builds it from a session's
 * totals + the best single-rock value (computed at the wiring point from the
 * session's prospects × the live price book).
 */

import type { Db } from "@lodestar/data";

export const BEST_CATEGORIES = [
  "tons_per_hour",
  "credits_per_hour",
  "single_rock_value",
  "longest_session",
  "most_tons",
] as const;

export type BestCategory = (typeof BEST_CATEGORIES)[number];

export interface PersonalBest {
  readonly category: BestCategory;
  readonly value: number;
  readonly sessionId: number | null;
  readonly ship: string | null;
  readonly ring: string | null;
  readonly achievedAt: string;
}

export interface SessionBestInput {
  readonly sessionId: number;
  readonly ship: string | null;
  readonly ring: string | null;
  /** The session's date (its ended-at), stored as the record's `achieved_at`. */
  readonly achievedAt: string;
  readonly values: Readonly<Record<BestCategory, number>>;
}

export interface PersonalBestsStore {
  /** Update strictly-beaten records for an ended session; return the newly-beaten ones. */
  check: (input: SessionBestInput) => PersonalBest[];
  /** The current records, ordered by category. */
  list: () => PersonalBest[];
}

interface BestRow {
  readonly category: BestCategory;
  readonly value: number;
  readonly session_id: number | null;
  readonly ship: string | null;
  readonly ring: string | null;
  readonly achieved_at: string;
}

/** Build the per-category value set from a session's totals + its best single-rock value. */
export function sessionBestValues(
  session: {
    readonly tonsPerHour: number;
    readonly creditsPerHour: number;
    readonly durationSec: number;
    readonly tonsRefined: number;
  },
  singleRockValue: number,
): Record<BestCategory, number> {
  return {
    tons_per_hour: session.tonsPerHour,
    credits_per_hour: session.creditsPerHour,
    single_rock_value: singleRockValue,
    longest_session: session.durationSec,
    most_tons: session.tonsRefined,
  };
}

/**
 * PURE fold of a whole session history into the current records — the Manifest's
 * personal-best board (no DB writes; the persisted store is for the live
 * `session.newBest` celebration). Later inputs replace only strictly-beaten records.
 */
export function foldPersonalBests(inputs: readonly SessionBestInput[]): PersonalBest[] {
  const best = new Map<BestCategory, PersonalBest>();
  for (const input of inputs) {
    for (const category of BEST_CATEGORIES) {
      const value = input.values[category];
      if (!Number.isFinite(value) || value <= 0) continue;
      const current = best.get(category);
      if (current === undefined || value > current.value) {
        best.set(category, {
          category,
          value,
          sessionId: input.sessionId,
          ship: input.ship,
          ring: input.ring,
          achievedAt: input.achievedAt,
        });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.category.localeCompare(b.category));
}

export function createPersonalBestsStore(db: Db): PersonalBestsStore {
  const getValue = db.prepare("SELECT value FROM personal_bests WHERE category = ?");
  const upsert = db.prepare(
    `INSERT INTO personal_bests (category, value, session_id, ship, ring, achieved_at)
       VALUES (@category, @value, @sessionId, @ship, @ring, @achievedAt)
     ON CONFLICT(category) DO UPDATE SET
       value = @value, session_id = @sessionId, ship = @ship, ring = @ring, achieved_at = @achievedAt`,
  );
  const listStmt = db.prepare(
    "SELECT category, value, session_id, ship, ring, achieved_at FROM personal_bests ORDER BY category",
  );

  const check = db.transaction((input: SessionBestInput): PersonalBest[] => {
    const beaten: PersonalBest[] = [];
    for (const category of BEST_CATEGORIES) {
      const value = input.values[category];
      // A record must be a real, positive number — a 0/NaN never sets a "best".
      if (!Number.isFinite(value) || value <= 0) continue;
      const current = getValue.get(category) as { value: number } | undefined;
      if (current === undefined || value > current.value) {
        upsert.run({
          category,
          value,
          sessionId: input.sessionId,
          ship: input.ship,
          ring: input.ring,
          achievedAt: input.achievedAt,
        });
        beaten.push({
          category,
          value,
          sessionId: input.sessionId,
          ship: input.ship,
          ring: input.ring,
          achievedAt: input.achievedAt,
        });
      }
    }
    return beaten;
  });

  return {
    check: (input) => check(input),
    list: () =>
      (listStmt.all() as BestRow[]).map((r) => ({
        category: r.category,
        value: r.value,
        sessionId: r.session_id,
        ship: r.ship,
        ring: r.ring,
        achievedAt: r.achieved_at,
      })),
  };
}
