/**
 * The ordered, forward-only migration set (SSOT §5.5 migration registry). Each
 * migration's SQL is an inlined TS template string (see 001-init.ts for the
 * rationale — no `.sql?raw` loader dependency, identical across tsc/vitest/
 * electron-vite). Every new migration appends here with the next contiguous
 * version.
 */

import type { Migration } from "../migrator.js";
import { INIT_001_SQL } from "./001-init.js";

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: "init", sql: INIT_001_SQL }];
