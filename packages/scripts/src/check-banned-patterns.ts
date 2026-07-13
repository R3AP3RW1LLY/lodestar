/**
 * Banned-pattern checker (SSOT §4.1 / Step 0.3): committed source carries no
 * work-deferred or sham-implementation markers, ever. Banned tokens are
 * assembled by concatenation so this file can define them without tripping
 * itself. Each line is NFKC-normalized and stripped of zero-width characters
 * first, so homoglyph/zero-width evasion is defeated; every match on a line is
 * reported, not just the first.
 *
 * Two banned sets (see MARKER_WORDS / MARKER_PHRASES / DOUBLE_RE below for the
 * authoritative, concatenation-split definitions):
 *  - MARKER set: work-deferred + sham-implementation tokens, banned EVERYWHERE,
 *    including test files.
 *  - DOUBLE set (the two test-double identifiers): banned in PRODUCT code only;
 *    test doubles for external services are permitted in *.test.ts (SSOT §4.2).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

export interface BannedHit {
  readonly file: string;
  readonly line: number;
  readonly match: string;
}

const MARKER_WORDS = ["TO" + "DO", "FIX" + "ME", "XX" + "X", "HA" + "CK"];
const MARKER_PHRASES = [
  "un" + "implemented",
  "place" + "holder",
  "st" + "ub(?:bed)?",
  "not\\s+" + "implemented",
];
const MARKER_RE = new RegExp(`\\b(?:${[...MARKER_WORDS, ...MARKER_PHRASES].join("|")})\\b`, "gi");

// Substring (not word-boundary) so test-double identifiers are caught inside
// product identifiers. "double" is deliberately NOT here — as a bare token it
// collides with the primitive type and common English.
const DOUBLE_RE = new RegExp(`(?:${"fa" + "ke"}|${"mo" + "ck"})`, "gi");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".py", ".sql"]);
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "out",
  "build",
  "coverage",
  ".git",
  ".turbo",
  ".venv",
  "__pycache__",
]);

// Segment-anchored: matches a real `test/fixtures` path segment, never
// `latest/fixtures` or `contest/fixtures`.
const FIXTURE_RE = /(?:^|[\\/])test[\\/]fixtures(?:[\\/]|$)/;

// Zero-width space/non-joiner/joiner, word joiner, BOM.
const ZERO_WIDTH_RE = /[​‌‍⁠﻿]/g;

function normalizeLine(line: string): string {
  return line.replace(ZERO_WIDTH_RE, "").normalize("NFKC");
}

function isTestFile(path: string): boolean {
  // .test.* (unit) and .spec.* (e2e) files may use test-double vocabulary.
  return /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/.test(path);
}

export function scanContent(content: string, isTest = false): { line: number; match: string }[] {
  const hits: { line: number; match: string }[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = normalizeLine(lines[i] ?? "");
    for (const match of line.matchAll(MARKER_RE)) {
      hits.push({ line: i + 1, match: match[0] });
    }
    if (!isTest) {
      for (const match of line.matchAll(DOUBLE_RE)) {
        hits.push({ line: i + 1, match: match[0] });
      }
    }
  }
  return hits;
}

function isFixturePath(path: string): boolean {
  return FIXTURE_RE.test(path);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot);
}

export function findBannedPatterns(root: string): BannedHit[] {
  const hits: BannedHit[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stats = statSync(full);
      if (stats.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry) || isFixturePath(full + sep)) continue;
        walk(full);
      } else if (SOURCE_EXTENSIONS.has(extensionOf(entry)) && !isFixturePath(full)) {
        for (const hit of scanContent(readFileSync(full, "utf8"), isTestFile(full))) {
          hits.push({ file: relative(root, full), line: hit.line, match: hit.match });
        }
      }
    }
  };
  walk(root);
  return hits;
}

/** Runs the check over `root` and returns the process exit code (0 clean, 1 dirty). */
export function runBannedPatternsCli(root: string): number {
  const hits = findBannedPatterns(root);
  if (hits.length > 0) {
    for (const hit of hits) {
      console.error(`${hit.file}:${String(hit.line)} — banned marker "${hit.match}"`);
    }
    console.error(
      `\n${String(hits.length)} banned marker(s) found. LODESTAR commits no placeholders.`,
    );
    return 1;
  }
  console.log("banned-patterns: clean");
  return 0;
}

const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  process.exit(runBannedPatternsCli(fileURLToPath(new URL("../../../", import.meta.url))));
}
