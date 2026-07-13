/**
 * Migration 004 — market_snapshots (SSOT §5.5, Step 2.5). Commodity sell prices
 * per market, keyed by CANONICAL commodity id (Step 2.2), with the observation's
 * source and source-timestamp. One row per (commodity, market, source) — the
 * latest observation wins (upsert). The price book reads the best-known sell
 * price across markets. Designed so Phase 4's migration 006 extends it ADDITIVELY
 * (new `source` values like 'eddn'/'inara'/'capi' need no schema change; new
 * columns arrive via ADD COLUMN — never a table rebuild).
 */
export const MARKET_004_SQL = `
CREATE TABLE market_snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  commodity_id TEXT    NOT NULL,
  market_id    INTEGER NOT NULL,
  sell_price   INTEGER NOT NULL,
  source       TEXT    NOT NULL,
  source_ts    TEXT    NOT NULL,
  station_name TEXT,
  star_system  TEXT,
  UNIQUE (commodity_id, market_id, source)
);
-- Serves the price-book's best() lookup: WHERE commodity_id = ? ORDER BY
-- sell_price DESC, source_ts DESC. The UNIQUE constraint's auto-index already
-- covers plain commodity_id lookups, so this composite earns its keep by also
-- satisfying the sort (no temp b-tree), rather than duplicating that prefix.
CREATE INDEX idx_market_best ON market_snapshots (commodity_id, sell_price DESC, source_ts DESC);
`;
