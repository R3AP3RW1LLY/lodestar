/**
 * The ordered, forward-only migration set (SSOT §5.5 migration registry). Each
 * migration's SQL is an inlined TS template string (see 001-init.ts for the
 * rationale — no `.sql?raw` loader dependency, identical across tsc/vitest/
 * electron-vite). Every new migration appends here with the next contiguous
 * version.
 */

import type { Migration } from "../migrator.js";
import { INIT_001_SQL } from "./001-init.js";
import { SESSIONS_002_SQL } from "./002-sessions.js";
import { PROSPECTS_003_SQL } from "./003-prospects.js";
import { MARKET_004_SQL } from "./004-market.js";

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "init", sql: INIT_001_SQL },
  { version: 2, name: "sessions", sql: SESSIONS_002_SQL },
  { version: 3, name: "prospects", sql: PROSPECTS_003_SQL },
  { version: 4, name: "market", sql: MARKET_004_SQL },
];
