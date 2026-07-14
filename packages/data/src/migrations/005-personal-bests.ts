/**
 * Migration 005 — personal_bests (SSOT §5.5, Step 3.4). One row per tracked best
 * (the category is the primary key), holding the record value + the context of the
 * session that set it (ship, ring, date, session_id). Updated transactionally at
 * session end and only when strictly beaten. Only the user's OWN records — local
 * per-profile DB. Categories are an open text set (see `BestCategory` in core) so a
 * new best type needs no schema change, just a new key.
 */
export const PERSONAL_BESTS_005_SQL = `
CREATE TABLE personal_bests (
  category    TEXT    PRIMARY KEY,
  value       REAL    NOT NULL,
  session_id  INTEGER REFERENCES sessions(id),
  ship        TEXT,
  ring        TEXT,
  achieved_at TEXT    NOT NULL
);
`;
