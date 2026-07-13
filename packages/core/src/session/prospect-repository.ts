/**
 * Prospect persistence (SSOT Step 2.1). Each `ProspectedAsteroid` observation is
 * stored as an independent row (no asteroid identity → no "same rock" claims),
 * keyed to the active session when one is open. `markLastCracked` records a
 * deep-core outcome by flagging the session's MOST RECENT prospect — a purely
 * TEMPORAL linkage (an `AsteroidCracked` follows the deep-core prospect), never an
 * identity match. Only the user's own local data. Assay verdict/reasoning columns
 * are written by later steps (2.4/2.8); this step persists the raw observation.
 */

import type { Db } from "@lodestar/data";
import type { Prospect, ProspectMaterial } from "../journal/events/prospected-asteroid.js";

export interface StoredProspect extends Prospect {
  readonly id: number;
  /** The session this observation was keyed to, or undefined if none was active. */
  readonly sessionId: number | undefined;
  /** The Assay MINE/SKIP call once assayed (2.6), or undefined before. */
  readonly verdict: "MINE" | "SKIP" | undefined;
  /** Structured verdict reasons as JSON (2.6), or undefined before assay. */
  readonly reasoning: string | undefined;
  /** Whether the commander acted on this prospect (mined/cracked after a MINE, 2.6). */
  readonly actedOn: boolean;
}

export interface ProspectRepository {
  /** Persist a prospect observation; returns its row id. */
  save(prospect: Prospect, sessionId?: number): number;
  /**
   * Persist the Assay verdict + its structured reasoning (JSON) onto a prospect
   * row (2.6). `verdict` is the MINE/SKIP call; `reasoning` is the serialized
   * reason list so the UI/TTS render it verbatim.
   */
  saveVerdict(id: number, verdict: "MINE" | "SKIP", reasoning: string): void;
  /**
   * Flag a prospect as acted-on — a `MiningRefined`/`AsteroidCracked` of the
   * verdict commodity followed its MINE call (2.6). Idempotent; returns whether a
   * row matched.
   */
  markActedOn(id: number): boolean;
  /**
   * Flag a specific prospect as deep-core cracked (2.6). A TEMPORAL linkage (an
   * `AsteroidCracked` follows the deep-core prospect), never an identity match —
   * the orchestrator passes the currently-open MINE prospect (the rock being
   * cracked), so the flag lands on that exact rock rather than a "most recent"
   * heuristic. Returns whether a row matched.
   */
  markCracked(id: number): boolean;
  /** Observations for a session, oldest first. */
  listBySession(sessionId: number): StoredProspect[];
  /** The most recent observations across all sessions, newest first. */
  listRecent(limit?: number): StoredProspect[];
}

interface ProspectRow {
  readonly id: number;
  readonly session_id: number | null;
  readonly timestamp: string;
  readonly content: string;
  readonly remaining_pct: number;
  readonly motherlode: string | null;
  readonly materials: string;
  readonly cracked: number;
  readonly verdict: string | null;
  readonly reasoning: string | null;
  readonly acted_on: number;
}

function parseMaterials(json: string): ProspectMaterial[] {
  // We always write a JSON array — a malformed string or non-array shape means
  // the row was corrupted/tampered with, so surface it loudly rather than
  // silently drop the materials (consistent with the no-silent-failure ethos).
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("prospect.materials: expected a JSON array");
  return parsed as ProspectMaterial[];
}

export function createProspectRepository(db: Db): ProspectRepository {
  const insert = db.prepare(
    `INSERT INTO prospects (session_id, timestamp, content, remaining_pct, motherlode, materials, cracked)
     VALUES (@sessionId, @timestamp, @content, @remainingPct, @motherlode, @materials, @cracked)`,
  );
  const setVerdict = db.prepare(
    "UPDATE prospects SET verdict = @verdict, reasoning = @reasoning WHERE id = @id",
  );
  const setActedOn = db.prepare("UPDATE prospects SET acted_on = 1 WHERE id = ?");
  const setCracked = db.prepare("UPDATE prospects SET cracked = 1 WHERE id = ?");
  const bySession = db.prepare("SELECT * FROM prospects WHERE session_id = ? ORDER BY id");
  const recent = db.prepare("SELECT * FROM prospects ORDER BY id DESC LIMIT ?");

  function rebuild(row: ProspectRow): StoredProspect {
    return {
      id: row.id,
      sessionId: row.session_id ?? undefined,
      timestamp: row.timestamp,
      content: row.content,
      remainingPct: row.remaining_pct,
      ...(row.motherlode !== null ? { motherlode: row.motherlode } : {}),
      materials: parseMaterials(row.materials),
      cracked: row.cracked === 1,
      verdict: row.verdict === "MINE" || row.verdict === "SKIP" ? row.verdict : undefined,
      reasoning: row.reasoning ?? undefined,
      actedOn: row.acted_on === 1,
    };
  }

  return {
    save: (prospect, sessionId) =>
      Number(
        insert.run({
          sessionId: sessionId ?? null,
          timestamp: prospect.timestamp,
          content: prospect.content,
          remainingPct: prospect.remainingPct,
          motherlode: prospect.motherlode ?? null,
          materials: JSON.stringify(prospect.materials),
          cracked: prospect.cracked ? 1 : 0,
        }).lastInsertRowid,
      ),
    saveVerdict: (id, verdict, reasoning) => {
      setVerdict.run({ id, verdict, reasoning });
    },
    markActedOn: (id) => setActedOn.run(id).changes > 0,
    markCracked: (id) => setCracked.run(id).changes > 0,
    listBySession: (sessionId) => (bySession.all(sessionId) as ProspectRow[]).map(rebuild),
    listRecent: (limit = 50) => (recent.all(limit) as ProspectRow[]).map(rebuild),
  };
}
