import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// The corpus lives here; @lodestar/scripts' scrub-journal.test.ts gates the same
// files for PII by filesystem path (it may not import @lodestar/core). Keep both
// in sync if this directory ever moves.
const FIXTURE_DIR = fileURLToPath(new URL("../../test/fixtures/journal/", import.meta.url));

const BOM = 0xfeff;

interface ManifestFile {
  readonly name: string;
  readonly isJournalLog: boolean;
  readonly rotationBase?: string;
  readonly rotationPart?: number;
  readonly edges: readonly string[];
  readonly events: readonly string[];
}
interface Manifest {
  readonly requiredEvents: readonly string[];
  readonly requiredEdges: readonly string[];
  readonly files: readonly ManifestFile[];
}

const manifest = JSON.parse(readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8")) as Manifest;

interface Parsed {
  readonly events: string[];
  readonly unparseableLineIndexes: number[];
  readonly totalLines: number;
  readonly endsWithNewline: boolean;
}

function parseFixture(name: string): Parsed {
  const text = readFileSync(join(FIXTURE_DIR, name), "utf8");
  const raw = text.charCodeAt(0) === BOM ? text.slice(1) : text;
  const endsWithNewline = raw.endsWith("\n");
  const split = raw.split(/\r?\n/);
  // Drop only a trailing empty element produced by a final newline; a partial
  // last line (no newline) is preserved as a real line.
  const lines = split[split.length - 1] === "" ? split.slice(0, -1) : split;
  const events: string[] = [];
  const unparseableLineIndexes: number[] = [];
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    try {
      const obj = JSON.parse(line) as { event?: unknown };
      if (typeof obj.event === "string") events.push(obj.event);
    } catch {
      unparseableLineIndexes.push(i);
    }
  });
  return { events, unparseableLineIndexes, totalLines: lines.length, endsWithNewline };
}

describe("journal fixture corpus", () => {
  it("every manifest file exists on disk", () => {
    const onDisk = new Set(readdirSync(FIXTURE_DIR));
    for (const f of manifest.files) expect(onDisk.has(f.name), f.name).toBe(true);
  });

  it("every committed .log is documented in the manifest (no orphans)", () => {
    const documented = new Set(manifest.files.map((f) => f.name));
    for (const log of readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".log"))) {
      expect(documented.has(log), `${log} missing from manifest`).toBe(true);
    }
  });

  it("each file's parseable events match its manifest declaration", () => {
    for (const f of manifest.files) {
      const found = [...new Set(parseFixture(f.name).events)].sort();
      expect(found, f.name).toEqual([...new Set(f.events)].sort());
    }
  });

  it("the corpus covers every required §5.1 event", () => {
    const all = new Set(manifest.files.flatMap((f) => parseFixture(f.name).events));
    for (const evt of manifest.requiredEvents) {
      expect(all.has(evt), `corpus missing event: ${evt}`).toBe(true);
    }
  });

  it("exercises the UTF-8 BOM edge (bytes present; stripped content parses clean)", () => {
    const bytes = readFileSync(join(FIXTURE_DIR, "edge-bom.log"));
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(parseFixture("edge-bom.log").unparseableLineIndexes).toEqual([]);
  });

  it("exercises the partial-last-line (in-progress growth) edge", () => {
    const p = parseFixture("edge-partial-last-line.log");
    expect(p.endsWithNewline).toBe(false);
    expect(p.unparseableLineIndexes).toContain(p.totalLines - 1);
  });

  it("exercises the truncated-midline edge (a bad line between good ones)", () => {
    const p = parseFixture("edge-truncated-midline.log");
    expect(p.unparseableLineIndexes.length).toBe(1);
    const bad = p.unparseableLineIndexes[0] ?? -1;
    expect(bad).toBeGreaterThan(0); // not the first line
    expect(bad).toBeLessThan(p.totalLines - 1); // and not the last — genuinely mid-file
  });

  it("provides a rotation pair (same base, parts 1 and 2)", () => {
    const byBase = new Map<string, Set<number>>();
    for (const f of manifest.files) {
      if (!f.isJournalLog || f.rotationBase === undefined || f.rotationPart === undefined) continue;
      const parts = byBase.get(f.rotationBase) ?? new Set<number>();
      parts.add(f.rotationPart);
      byBase.set(f.rotationBase, parts);
    }
    const hasPair = [...byBase.values()].some((parts) => parts.has(1) && parts.has(2));
    expect(hasPair).toBe(true);
  });

  it("declares every required edge somewhere in the corpus", () => {
    const declared = new Set(manifest.files.flatMap((f) => f.edges));
    declared.add("rotation-pair"); // structural — asserted by the rotation-pair test
    for (const edge of manifest.requiredEdges) {
      expect(declared.has(edge), `no fixture exercises edge: ${edge}`).toBe(true);
    }
  });
});
