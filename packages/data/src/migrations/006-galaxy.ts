/**
 * Migration 006 — galaxy reference + planning (SSOT §5.5, Step 4.1). Systems /
 * bodies / rings / stations are reference data (coords, pad sizes, ring type,
 * reserve); hotspots + overlaps hold mining intel with provenance; runs holds
 * planned/actual trips. `market_snapshots` is extended ADDITIVELY (ADD COLUMN +
 * one index) — it already holds Phase 2–3 user data, so it is NEVER rebuilt.
 *
 * Indexes serve the hot queries: spatial distance (a bounding-box prefilter on the
 * x axis, refined in TS), ring/body/system lookups, and hotspot-by-commodity. Only
 * the user's OWN + public reference data lands here (local per-profile DB).
 */
export const GALAXY_006_SQL = `
CREATE TABLE systems (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  address    INTEGER UNIQUE,           -- systemAddress / id64 (null when only a name is known)
  name       TEXT    NOT NULL,
  x          REAL    NOT NULL,
  y          REAL    NOT NULL,
  z          REAL    NOT NULL,
  updated_at TEXT    NOT NULL
);
CREATE UNIQUE INDEX idx_systems_name ON systems (name);
-- Distance queries bound a cube on the x axis (idx range scan) then refine to a
-- sphere in TS — avoids a full scan before the Euclidean test (see systems.within).
CREATE INDEX idx_systems_x ON systems (x);

CREATE TABLE bodies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  system_id  INTEGER NOT NULL REFERENCES systems(id),
  name       TEXT    NOT NULL,
  body_type  TEXT,
  updated_at TEXT    NOT NULL,
  UNIQUE (system_id, name)
);
CREATE INDEX idx_bodies_system ON bodies (system_id);

CREATE TABLE rings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  body_id    INTEGER NOT NULL REFERENCES bodies(id),
  name       TEXT    NOT NULL,
  ring_type  TEXT,                     -- normalized: Icy | Rocky | Metallic | MetalRich
  reserve    TEXT,                     -- Pristine | Major | Common | Low | Depleted
  updated_at TEXT    NOT NULL,
  UNIQUE (body_id, name)
);
CREATE INDEX idx_rings_body ON rings (body_id);

CREATE TABLE stations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  system_id    INTEGER NOT NULL REFERENCES systems(id),
  market_id    INTEGER UNIQUE,         -- marketId (nullable)
  name         TEXT    NOT NULL,
  pad_size     TEXT,                   -- S | M | L (largest pad)
  station_type TEXT,
  distance_ls  REAL,                   -- distance to arrival (ls)
  updated_at   TEXT    NOT NULL,
  UNIQUE (system_id, name)
);
CREATE INDEX idx_stations_system ON stations (system_id);

CREATE TABLE hotspots (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ring_id        INTEGER NOT NULL REFERENCES rings(id),
  commodity_id   TEXT    NOT NULL,     -- canonical commodity id (Step 2.2)
  count          INTEGER NOT NULL DEFAULT 1,
  source         TEXT    NOT NULL DEFAULT 'journal' CHECK (source IN ('seed', 'journal', 'community')),
  first_seen     TEXT    NOT NULL,
  last_confirmed TEXT    NOT NULL,
  UNIQUE (ring_id, commodity_id)
);
CREATE INDEX idx_hotspots_ring ON hotspots (ring_id);
CREATE INDEX idx_hotspots_commodity ON hotspots (commodity_id);

CREATE TABLE overlaps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ring_id      INTEGER NOT NULL REFERENCES rings(id),
  commodities  TEXT    NOT NULL,       -- JSON array of canonical commodity ids
  multiplicity INTEGER NOT NULL DEFAULT 2,
  confidence   TEXT    NOT NULL DEFAULT 'candidate' CHECK (confidence IN ('candidate', 'confirmed')),
  source       TEXT    NOT NULL DEFAULT 'journal',
  updated_at   TEXT    NOT NULL
);
CREATE INDEX idx_overlaps_ring ON overlaps (ring_id);

CREATE TABLE runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT    NOT NULL,
  plan          TEXT    NOT NULL,      -- full plan JSON
  estimated_tph REAL,
  estimated_cph REAL,
  actual_tph    REAL,
  actual_cph    REAL,
  status        TEXT    NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed', 'abandoned')),
  completed_at  TEXT
);

-- market_snapshots additive extension (no rebuild): sell-station ranking needs pad
-- size + demand; index star_system for by-system station lookups.
ALTER TABLE market_snapshots ADD COLUMN pad_size TEXT;
ALTER TABLE market_snapshots ADD COLUMN demand INTEGER;
CREATE INDEX idx_market_system ON market_snapshots (star_system);
`;
