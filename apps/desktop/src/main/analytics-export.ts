/**
 * CSV export service (SSOT Step 3.6) — the save-dialog wiring. Builds an RFC-4180
 * CSV of the requested dataset (sessions / refinements / prospects) via the pure
 * `@lodestar/core` exporters, shows the native save dialog, and writes the file.
 * The dialog + file write are injected so the logic is unit-tested without Electron
 * or the disk. Read-only over the user's OWN local data.
 */

import type { Db } from "@lodestar/data";
import {
  createAnalyticsRepository,
  prospectsCsv,
  refinementsCsv,
  sessionsCsv,
} from "@lodestar/core";
import type { ExportKind, ProspectExportRow, RefinementExportRow } from "@lodestar/core";

export interface SaveDialogResult {
  readonly canceled: boolean;
  readonly filePath?: string;
}

export interface AnalyticsExporterDeps {
  readonly db: Db;
  /** Show a native save dialog with a default filename; resolve to the chosen path. */
  readonly showSaveDialog: (defaultName: string) => Promise<SaveDialogResult>;
  readonly writeFile: (path: string, content: string) => Promise<void>;
}

export interface ExportResult {
  readonly ok: boolean;
  /** The written path, or null if the user cancelled. */
  readonly path: string | null;
}

export interface AnalyticsExporter {
  export: (kind: ExportKind, bom: boolean) => Promise<ExportResult>;
}

export function createAnalyticsExporter(deps: AnalyticsExporterDeps): AnalyticsExporter {
  const repo = createAnalyticsRepository(deps.db);

  const buildCsv = (kind: ExportKind, bom: boolean): string => {
    const opts = { bom };
    switch (kind) {
      case "sessions":
        return sessionsCsv(repo.listSessions(), opts);
      case "refinements":
        return refinementsCsv(
          deps.db
            .prepare(
              "SELECT session_id AS sessionId, timestamp, commodity, tons FROM refinements ORDER BY id",
            )
            .all() as RefinementExportRow[],
          opts,
        );
      case "prospects":
        return prospectsCsv(
          deps.db
            .prepare(
              `SELECT id, session_id AS sessionId, timestamp, content,
                 remaining_pct AS remainingPct, motherlode, verdict, acted_on AS actedOn
               FROM prospects ORDER BY id`,
            )
            .all() as ProspectExportRow[],
          opts,
        );
    }
  };

  return {
    export: async (kind, bom) => {
      const csv = buildCsv(kind, bom);
      const dialog = await deps.showSaveDialog(`lodestar-${kind}.csv`);
      if (dialog.canceled || dialog.filePath === undefined) return { ok: false, path: null };
      await deps.writeFile(dialog.filePath, csv);
      return { ok: true, path: dialog.filePath };
    },
  };
}
