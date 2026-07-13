/**
 * Migration 002 — sessions (SSOT §5.5, Step 1.8). One row per mining session plus
 * an append-only per-session typed event log and a per-ton refinements table. Only
 * the user's OWN data lands here (this is the local per-profile DB, not the public
 * repo) — third-party PII from unhandled events is never logged (the tracker only
 * appends the known session-relevant events).
 */
export const SESSIONS_002_SQL = `
CREATE TABLE sessions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at        TEXT NOT NULL,
  ended_at          TEXT,
  cmdr              TEXT,
  ship              TEXT,
  system            TEXT,
  body              TEXT,
  ring              TEXT,
  tons_refined      REAL    NOT NULL DEFAULT 0,
  credits_earned    INTEGER NOT NULL DEFAULT 0,
  limpets_launched  INTEGER NOT NULL DEFAULT 0,
  limpets_collected INTEGER NOT NULL DEFAULT 0,
  status            TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended'))
);

CREATE TABLE session_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  seq        INTEGER NOT NULL,
  timestamp  TEXT    NOT NULL,
  event_type TEXT    NOT NULL,
  payload    TEXT    NOT NULL
);
CREATE INDEX idx_session_events_session ON session_events (session_id, seq);

CREATE TABLE refinements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  timestamp  TEXT    NOT NULL,
  commodity  TEXT    NOT NULL,
  tons       REAL    NOT NULL DEFAULT 1
);
CREATE INDEX idx_refinements_session ON refinements (session_id);
`;
