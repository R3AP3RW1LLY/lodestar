/**
 * Migration 001 — init (SSOT §5.5). schema_migrations is created by the runner
 * itself; this migration creates the non-secret settings key/value store.
 * Secrets never live here (SSOT §4.6). SQL is inlined as a string (rather than
 * a `.sql?raw` import) so it type-checks and bundles identically across tsc,
 * vitest, and electron-vite with no loader dependency.
 */
export const INIT_001_SQL = `
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
