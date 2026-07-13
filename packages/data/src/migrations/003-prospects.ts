/**
 * Migration 003 — prospects (SSOT §5.5, Step 2.1). One row per `ProspectedAsteroid`
 * observation. Journals carry NO asteroid identity, so every event is stored as an
 * INDEPENDENT observation — never a "same rock" claim. Keyed to the active session
 * when one is open (nullable otherwise). `content` is the raw content-tier symbol,
 * `materials` a JSON array of {name, proportion}. `cracked` is a TEMPORAL deep-core
 * linkage (an `AsteroidCracked` following a deep-core prospect), never an identity.
 * `verdict`/`reasoning`/`acted_on` are filled by the Assay engine (Steps 2.4/2.8/UI)
 * and are nullable/default here.
 */
export const PROSPECTS_003_SQL = `
CREATE TABLE prospects (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    INTEGER REFERENCES sessions(id),
  timestamp     TEXT    NOT NULL,
  content       TEXT    NOT NULL,
  remaining_pct REAL    NOT NULL,
  motherlode    TEXT,
  materials     TEXT    NOT NULL,
  cracked       INTEGER NOT NULL DEFAULT 0,
  verdict       TEXT,
  reasoning     TEXT,
  acted_on      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_prospects_session ON prospects (session_id);
`;
