import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Tailer, nodeFileSource } from "./tailer.js";
import type { FileSnapshot, FileSource } from "./tailer.js";

const FIXTURE_DIR = fileURLToPath(new URL("../../test/fixtures/journal/", import.meta.url));

/** An in-memory FileSource whose bytes can be appended, truncated, or replaced. */
function memSource(): {
  source: FileSource;
  append: (s: string) => void;
  truncate: (bytes: number) => void;
  replace: (s: string) => void;
} {
  let buf = Buffer.alloc(0);
  let id = 1;
  return {
    source: {
      stat: (): FileSnapshot | null => ({ size: buf.length, id: `id-${String(id)}` }),
      read: (start, length): Buffer => Buffer.from(buf.subarray(start, start + length)),
    },
    append: (s) => {
      buf = Buffer.concat([buf, Buffer.from(s, "utf8")]);
    },
    truncate: (bytes) => {
      buf = Buffer.from(buf.subarray(0, bytes));
    },
    replace: (s) => {
      buf = Buffer.from(s, "utf8");
      id += 1;
    },
  };
}

const raws = (lines: { raw: string }[]): string[] => lines.map((l) => l.raw);

describe("Tailer — incremental line assembly", () => {
  it("emits complete lines with byte-offset provenance, buffering a partial trailing line", () => {
    const m = memSource();
    const t = new Tailer("J.log", m.source);
    m.append(`{"a":1}\n{"b":2}\n{"c":`); // third line incomplete
    const first = t.poll();
    expect(raws(first)).toEqual([`{"a":1}`, `{"b":2}`]);
    expect(first[0]?.byteOffset).toBe(0);
    expect(first[1]?.byteOffset).toBe(8); // after `{"a":1}\n` (8 bytes)
    expect(first[0]?.file).toBe("J.log");
    // The partial third line is NOT emitted until its newline arrives.
    m.append(`3}\n`);
    expect(raws(t.poll())).toEqual([`{"c":3}`]);
  });

  it("never emits, then never duplicates, across many small polls", () => {
    const m = memSource();
    const t = new Tailer("J.log", m.source);
    const all: string[] = [];
    for (let i = 0; i < 20; i++) {
      m.append(`{"n":${String(i)}}\n`);
      all.push(...raws(t.poll()));
      all.push(...raws(t.poll())); // a second poll with no new bytes must add nothing
    }
    expect(all).toHaveLength(20);
    expect(all[0]).toBe(`{"n":0}`);
    expect(all[19]).toBe(`{"n":19}`);
    expect(new Set(all).size).toBe(20); // no duplicates
  });

  it("strips a leading UTF-8 BOM from the first line only", () => {
    const m = memSource();
    const t = new Tailer("J.log", m.source);
    m.append(`﻿{"first":1}\n{"second":2}\n`);
    const lines = t.poll();
    expect(raws(lines)).toEqual([`{"first":1}`, `{"second":2}`]);
    expect(JSON.parse(lines[0]?.raw ?? "")).toEqual({ first: 1 });
  });

  it("tolerates CRLF line endings (strips the trailing CR)", () => {
    const m = memSource();
    const t = new Tailer("J.log", m.source);
    m.append(`{"a":1}\r\n{"b":2}\r\n`);
    expect(raws(t.poll())).toEqual([`{"a":1}`, `{"b":2}`]);
  });

  it("resets and re-reads from the start when the file is truncated (size regresses)", () => {
    const m = memSource();
    const t = new Tailer("J.log", m.source);
    m.append(`{"a":1}\n{"b":2}\n`);
    expect(raws(t.poll())).toEqual([`{"a":1}`, `{"b":2}`]);
    m.truncate(0);
    m.append(`{"x":9}\n`);
    expect(raws(t.poll())).toEqual([`{"x":9}`]); // fresh content, not lost or offset-skipped
  });

  it("resets when the file identity changes (replacement / rotation-in-place)", () => {
    const m = memSource();
    const t = new Tailer("J.log", m.source);
    m.append(`{"old":1}\n`);
    expect(raws(t.poll())).toEqual([`{"old":1}`]);
    m.replace(`{"new":1}\n{"new":2}\n`);
    expect(raws(t.poll())).toEqual([`{"new":1}`, `{"new":2}`]);
  });

  it("resumes from a persisted byte offset (no re-emit of already-consumed lines)", () => {
    const m = memSource();
    m.append(`{"a":1}\n{"b":2}\n`); // 16 bytes total
    const t = new Tailer("J.log", m.source, { startOffset: 8 });
    expect(raws(t.poll())).toEqual([`{"b":2}`]);
    expect(t.position).toBe(16);
  });

  it("position stays at a line boundary so resume never drops the in-flight partial line", () => {
    const m = memSource();
    const t = new Tailer("J.log", m.source);
    m.append(`{"a":1}\n{"b":2}\n{"c":3`); // 22 bytes: two whole lines + a 6-byte partial
    expect(raws(t.poll())).toEqual([`{"a":1}`, `{"b":2}`]);
    expect(t.position).toBe(16); // NOT 22 — the buffered partial bytes are not committed
    // Persist position, "crash", complete the line, resume: {"c":3} must survive intact.
    m.append(`}\n{"d":4}\n`);
    const resumed = new Tailer("J.log", m.source, { startOffset: t.position });
    expect(raws(resumed.poll())).toEqual([`{"c":3}`, `{"d":4}`]);
  });

  it("resets when already-consumed bytes are rewritten in place (same id, regrown past old offset)", () => {
    const m = memSource();
    const t = new Tailer("J.log", m.source);
    m.append(`{"a":1}\n{"b":2}\n`); // 16 bytes
    expect(raws(t.poll())).toEqual([`{"a":1}`, `{"b":2}`]);
    // Shrink to 0 then regrow PAST the old offset, same file identity — the size
    // and id checks both miss this; the content anchor must catch it.
    m.truncate(0);
    m.append(`{"x":1}\n{"y":2}\n{"z":3}\n`); // 24 bytes > old consumed (16)
    expect(raws(t.poll())).toEqual([`{"x":1}`, `{"y":2}`, `{"z":3}`]);
  });

  it("returns nothing when the file does not exist", () => {
    const t = new Tailer("J.log", { stat: () => null, read: () => Buffer.alloc(0) });
    expect(t.poll()).toEqual([]);
  });

  it("emits a malformed line as raw (JSON validity is the parser's job, not the tailer's)", () => {
    const m = memSource();
    const t = new Tailer("J.log", m.source);
    m.append(`{"ok":1}\n{"bad":\n{"ok":2}\n`);
    expect(raws(t.poll())).toEqual([`{"ok":1}`, `{"bad":`, `{"ok":2}`]);
  });
});

describe("Tailer over the real fixture corpus (nodeFileSource)", () => {
  function readAll(name: string, startOffset = 0): { raw: string }[] {
    const t = new Tailer(name, nodeFileSource(join(FIXTURE_DIR, name)), { startOffset });
    return t.poll();
  }

  it("reads a full journal session file, one event per line", () => {
    const lines = readAll("Journal.2025-06-01T120000.01.log");
    expect(lines.length).toBeGreaterThan(10);
    for (const l of lines)
      expect(() => {
        JSON.parse(l.raw);
      }).not.toThrow();
    expect(JSON.parse(lines[0]?.raw ?? "")).toMatchObject({ event: "Fileheader" });
  });

  it("strips the BOM on edge-bom.log so both lines parse", () => {
    const lines = readAll("edge-bom.log");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]?.raw ?? "")).toMatchObject({ event: "MiningRefined" });
  });

  it("buffers the partial last line of edge-partial-last-line.log (never emits it)", () => {
    const lines = readAll("edge-partial-last-line.log");
    expect(lines).toHaveLength(2); // the 3rd, partial line is withheld
    // The withheld line is the only one timestamped 12:00:02 — it must not appear.
    expect(raws(lines).some((r) => r.includes("12:00:02"))).toBe(false);
  });

  it("emits the mid-file malformed line of edge-truncated-midline.log without losing the good ones", () => {
    const lines = readAll("edge-truncated-midline.log");
    expect(lines).toHaveLength(3);
    const parseable = lines.filter((l) => {
      try {
        JSON.parse(l.raw);
        return true;
      } catch {
        return false;
      }
    });
    expect(parseable).toHaveLength(2); // two good, one malformed — but all three emitted
  });
});

describe("nodeFileSource", () => {
  it("reports size + a stable id and reads byte ranges; returns null for a missing file", () => {
    const dir = mkdtempSync(join(tmpdir(), "lodestar-tailer-"));
    try {
      const path = join(dir, "live.log");
      writeFileSync(path, `{"a":1}\n`);
      const src = nodeFileSource(path);
      const s1 = src.stat();
      expect(s1?.size).toBe(8);
      appendFileSync(path, `{"b":2}\n`);
      expect(src.stat()?.size).toBe(16);
      expect(src.read(8, 8).toString("utf8")).toBe(`{"b":2}\n`);
      expect(nodeFileSource(join(dir, "nope.log")).stat()).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resets cleanly on a real in-place truncate and on a real O_TRUNC overwrite", () => {
    const dir = mkdtempSync(join(tmpdir(), "lodestar-tailer-fs-"));
    try {
      const path = join(dir, "Journal.log");
      writeFileSync(path, `{"a":1}\n{"b":2}\n`);
      const t = new Tailer(path, nodeFileSource(path));
      expect(raws(t.poll())).toEqual([`{"a":1}`, `{"b":2}`]);
      // O_TRUNC overwrite with longer, different content. On NTFS ino/birthtime
      // survive (anchor catches it); on other FS the id changes (replaced catches
      // it). Either way: no loss, no stale-offset read.
      writeFileSync(path, `{"x":1}\n{"y":2}\n{"z":3}\n`);
      expect(raws(t.poll())).toEqual([`{"x":1}`, `{"y":2}`, `{"z":3}`]);
      // A pure truncation to a shorter length then a fresh append.
      writeFileSync(path, `{"p":1}\n`);
      expect(raws(t.poll())).toEqual([`{"p":1}`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
