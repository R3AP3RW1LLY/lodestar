/**
 * RFC-4180 CSV export + parse (SSOT Step 3.6). PURE string transforms: fields are
 * comma-separated, records CRLF-separated, and any field containing a comma, double
 * quote, CR, or LF is wrapped in double quotes with embedded quotes doubled. `null`
 * becomes an empty field. An optional UTF-8 BOM makes Excel open UTF-8 correctly.
 * `parseCsv` is the inverse (used to prove round-trip identity in tests + reusable).
 */

import type { SessionListItem } from "./aggregates.js";

export type CsvValue = string | number | null;

export interface CsvOptions {
  /** Prepend a UTF-8 BOM (﻿) so Excel reads UTF-8 correctly. */
  readonly bom?: boolean;
}

const CRLF = "\r\n";
const NEEDS_QUOTING = /[",\r\n]/;

function escapeField(value: CsvValue): string {
  if (value === null) return "";
  const s = typeof value === "number" ? String(value) : value;
  return NEEDS_QUOTING.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize a header + rows to RFC-4180 CSV (trailing CRLF; optional BOM). */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly CsvValue[])[],
  opts: CsvOptions = {},
): string {
  const body = [header, ...rows].map((row) => row.map(escapeField).join(",")).join(CRLF) + CRLF;
  return opts.bom === true ? `﻿${body}` : body;
}

/** Parse RFC-4180 CSV back into rows of string fields (strips a leading BOM). */
export function parseCsv(text: string): string[][] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < s.length) {
    const c = s.charAt(i); // always a string (no noUncheckedIndexedAccess undefined)
    if (inQuotes) {
      if (c === '"') {
        if (s.charAt(i + 1) === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
    } else if (c === "\r") {
      i += 1; // CRLF: the following \n ends the record
    } else {
      field += c;
      i += 1;
    }
  }
  // Flush a final unterminated record (no trailing newline).
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const SESSION_HEADER = [
  "id",
  "started_at",
  "ended_at",
  "ship",
  "system",
  "ring",
  "tons_refined",
  "credits_earned",
  "limpets_launched",
  "duration_sec",
  "tons_per_hour",
  "credits_per_hour",
  "prospected",
  "mine_verdicts",
] as const;

export function sessionsCsv(sessions: readonly SessionListItem[], opts?: CsvOptions): string {
  const rows = sessions.map((s): CsvValue[] => [
    s.id,
    s.startedAt,
    s.endedAt,
    s.ship,
    s.system,
    s.ring,
    s.tonsRefined,
    s.creditsEarned,
    s.limpetsLaunched,
    s.durationSec,
    s.tonsPerHour,
    s.creditsPerHour,
    s.prospected,
    s.mineVerdicts,
  ]);
  return toCsv([...SESSION_HEADER], rows, opts);
}

export interface RefinementExportRow {
  readonly sessionId: number;
  readonly timestamp: string;
  readonly commodity: string;
  readonly tons: number;
}

export function refinementsCsv(rows: readonly RefinementExportRow[], opts?: CsvOptions): string {
  return toCsv(
    ["session_id", "timestamp", "commodity", "tons"],
    rows.map((r): CsvValue[] => [r.sessionId, r.timestamp, r.commodity, r.tons]),
    opts,
  );
}

export interface ProspectExportRow {
  readonly id: number;
  readonly sessionId: number | null;
  readonly timestamp: string;
  readonly content: string;
  readonly remainingPct: number;
  readonly motherlode: string | null;
  readonly verdict: string | null;
  readonly actedOn: number;
}

export function prospectsCsv(rows: readonly ProspectExportRow[], opts?: CsvOptions): string {
  return toCsv(
    [
      "id",
      "session_id",
      "timestamp",
      "content",
      "remaining_pct",
      "motherlode",
      "verdict",
      "acted_on",
    ],
    rows.map((r): CsvValue[] => [
      r.id,
      r.sessionId,
      r.timestamp,
      r.content,
      r.remainingPct,
      r.motherlode,
      r.verdict,
      r.actedOn,
    ]),
    opts,
  );
}

export type ExportKind = "sessions" | "refinements" | "prospects";
