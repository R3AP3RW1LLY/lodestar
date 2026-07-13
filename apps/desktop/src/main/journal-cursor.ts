/**
 * Journal cursor persistence (SSOT Step 1.9a). A tiny JSON file in the data dir
 * recording how far the live engine has consumed the current journal, so a
 * restart resumes past already-processed lines instead of re-folding them into
 * duplicate session rows. Runtime state, not domain data — hence a plain file,
 * not a SQLite migration. Best-effort: a missing/corrupt file resumes from the
 * start (safe — the engine backfills), and a failed write is non-fatal.
 */

import { readFileSync, writeFileSync } from "node:fs";
import type { JournalCursor, JournalCursorStore } from "@lodestar/core";

export function fileJournalCursorStore(path: string): JournalCursorStore {
  return {
    load(): JournalCursor | undefined {
      try {
        const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof (parsed as JournalCursor).file === "string" &&
          typeof (parsed as JournalCursor).offset === "number" &&
          (parsed as JournalCursor).offset >= 0
        ) {
          const cursor = parsed as JournalCursor;
          return { file: cursor.file, offset: cursor.offset };
        }
      } catch {
        // Missing or corrupt cursor file → resume from the start (the engine backfills).
      }
      return undefined;
    },
    save(cursor: JournalCursor): void {
      try {
        writeFileSync(path, JSON.stringify(cursor), "utf8");
      } catch {
        // Best-effort — a dropped cursor write only costs a re-fold on the next restart.
      }
    },
  };
}
