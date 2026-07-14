/**
 * Migration 007 — alert_rules (SSOT §5.5, Step 4.11). User-defined alert rules for the
 * alert framework: `price-threshold` (a commodity's best sell price crossing above/below
 * a value) and `cargo-full` (cargo fill % reaching a level — the trigger for §1.1's sell
 * leg). Per-rule cooldown + enabled flag + last-fired timestamp for dedupe/throttle across
 * restarts. Wing hooks register into the same framework in Phase 9.
 */
export const ALERT_RULES_007_SQL = `
CREATE TABLE alert_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kind          TEXT    NOT NULL CHECK (kind IN ('price-threshold', 'cargo-full')),
  label         TEXT,
  commodity_id  TEXT,                     -- required for price-threshold
  threshold     REAL    NOT NULL,         -- price (cr) for price-threshold, fill % for cargo-full
  direction     TEXT    NOT NULL DEFAULT 'above' CHECK (direction IN ('above', 'below')),
  cooldown_ms   INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_fired_ts TEXT,
  created_at    TEXT    NOT NULL
);
CREATE INDEX idx_alert_rules_enabled ON alert_rules (enabled);
`;
