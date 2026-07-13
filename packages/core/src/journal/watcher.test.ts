import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JournalWatcher, compareJournals } from "./watcher.js";
import type { WatcherEvent, WatcherFs, WatcherLogger } from "./watcher.js";
import type { TailLine } from "./tailer.js";

function collector(): { emit: (e: WatcherEvent) => void; events: WatcherEvent[] } {
  const events: WatcherEvent[] = [];
  return { emit: (e) => events.push(e), events };
}
const journalRaws = (events: WatcherEvent[]): string[] =>
  events.filter((e) => e.source === "journal").map((e) => e.raw);

const line = (n: number): string =>
  `{"timestamp":"2025-06-01T12:00:0${String(n)}Z","event":"E${String(n)}"}\n`;

describe("JournalWatcher — integration over real temp files", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lodestar-watcher-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("backfills the newest journal from the start, then emits live appends", () => {
    writeFileSync(join(dir, "Journal.2025-06-01T120000.01.log"), line(1) + line(2));
    const c = collector();
    const w = new JournalWatcher({ dir, emit: c.emit });
    w.tick(); // backfill
    expect(journalRaws(c.events)).toEqual([
      `{"timestamp":"2025-06-01T12:00:01Z","event":"E1"}`,
      `{"timestamp":"2025-06-01T12:00:02Z","event":"E2"}`,
    ]);
    appendFileSync(join(dir, "Journal.2025-06-01T120000.01.log"), line(3));
    w.tick();
    expect(journalRaws(c.events).at(-1)).toBe(`{"timestamp":"2025-06-01T12:00:03Z","event":"E3"}`);
  });

  it("picks the NEWEST journal when several exist at start (not the first)", () => {
    writeFileSync(join(dir, "Journal.2025-06-01T110000.01.log"), line(1));
    writeFileSync(join(dir, "Journal.2025-06-01T120000.01.log"), line(2));
    const c = collector();
    new JournalWatcher({ dir, emit: c.emit }).tick();
    expect(journalRaws(c.events)).toEqual([`{"timestamp":"2025-06-01T12:00:02Z","event":"E2"}`]);
  });

  it("reports the active tailer's consumed byte position (a line boundary) for the cursor", () => {
    const name = "Journal.2025-06-01T120000.01.log";
    writeFileSync(join(dir, name), line(1) + line(2));
    const c = collector();
    const w = new JournalWatcher({ dir, emit: c.emit });
    expect(w.activePosition()).toBeUndefined(); // nothing tailing yet
    w.tick();
    expect(w.activePosition()).toEqual({
      file: name,
      offset: Buffer.byteLength(line(1) + line(2)),
    });
  });

  it("resumes the matching journal from the cursor offset (skips consumed lines)", () => {
    const name = "Journal.2025-06-01T120000.01.log";
    writeFileSync(join(dir, name), line(1) + line(2) + line(3));
    const offset = Buffer.byteLength(line(1) + line(2)); // already consumed through E2
    const c = collector();
    new JournalWatcher({ dir, emit: c.emit, resumeCursor: { file: name, offset } }).tick();
    expect(journalRaws(c.events)).toEqual([`{"timestamp":"2025-06-01T12:00:03Z","event":"E3"}`]);
  });

  it("ignores the cursor for a different (newly-appeared) journal and backfills from 0", () => {
    writeFileSync(join(dir, "Journal.2025-06-01T130000.01.log"), line(1) + line(2));
    const c = collector();
    // Cursor names an older file; the newest is a fresh file → backfill, not resume.
    new JournalWatcher({
      dir,
      emit: c.emit,
      resumeCursor: { file: "Journal.2025-06-01T120000.01.log", offset: 999 },
    }).tick();
    expect(journalRaws(c.events)).toEqual([
      `{"timestamp":"2025-06-01T12:00:01Z","event":"E1"}`,
      `{"timestamp":"2025-06-01T12:00:02Z","event":"E2"}`,
    ]);
  });

  it("with resumeAtEnd (no cursor) starts the cold-start file at its current end", () => {
    const name = "Journal.2025-06-01T120000.01.log";
    writeFileSync(join(dir, name), line(1) + line(2));
    const c = collector();
    const w = new JournalWatcher({ dir, emit: c.emit, resumeAtEnd: true });
    w.tick();
    expect(journalRaws(c.events)).toEqual([]); // started at EOF — nothing backfilled
    appendFileSync(join(dir, name), line(3)); // but new appends still flow
    w.tick();
    expect(journalRaws(c.events)).toEqual([`{"timestamp":"2025-06-01T12:00:03Z","event":"E3"}`]);
  });

  it("switches to a rotated-in newer file, draining the old one first (no lost lines)", () => {
    const first = join(dir, "Journal.2025-06-01T120000.01.log");
    writeFileSync(first, line(1));
    const c = collector();
    const w = new JournalWatcher({ dir, emit: c.emit });
    w.tick();
    // The game writes one more line to the OLD file, THEN rotates to a new file.
    appendFileSync(first, line(2));
    writeFileSync(join(dir, "Journal.2025-06-01T130000.01.log"), line(3));
    w.tick();
    // E2 (old file tail) must not be lost, and E3 (new file) is picked up.
    expect(journalRaws(c.events)).toEqual([
      `{"timestamp":"2025-06-01T12:00:01Z","event":"E1"}`,
      `{"timestamp":"2025-06-01T12:00:02Z","event":"E2"}`,
      `{"timestamp":"2025-06-01T12:00:03Z","event":"E3"}`,
    ]);
  });

  it("does not lose an intermediate journal when TWO rotations land in one tick", () => {
    writeFileSync(join(dir, "Journal.2025-06-01T120000.01.log"), line(1));
    const c = collector();
    const w = new JournalWatcher({ dir, emit: c.emit });
    w.tick();
    // Main-thread stall / relaunch: two new files appear before the next tick.
    writeFileSync(join(dir, "Journal.2025-06-01T130000.01.log"), line(2));
    writeFileSync(join(dir, "Journal.2025-06-01T140000.01.log"), line(3));
    w.tick();
    // The intermediate 1300 file must NOT be skipped.
    expect(journalRaws(c.events)).toEqual([
      `{"timestamp":"2025-06-01T12:00:01Z","event":"E1"}`,
      `{"timestamp":"2025-06-01T12:00:02Z","event":"E2"}`,
      `{"timestamp":"2025-06-01T12:00:03Z","event":"E3"}`,
    ]);
  });

  it("jumps to the newest file (without replaying history) if the active file disappears", () => {
    const first = join(dir, "Journal.2025-06-01T120000.01.log");
    writeFileSync(first, line(1));
    const c = collector();
    const w = new JournalWatcher({ dir, emit: c.emit });
    w.tick();
    unlinkSync(first); // active file removed
    writeFileSync(join(dir, "Journal.2025-06-01T130000.01.log"), line(2));
    w.tick();
    expect(journalRaws(c.events)).toEqual([
      `{"timestamp":"2025-06-01T12:00:01Z","event":"E1"}`,
      `{"timestamp":"2025-06-01T12:00:02Z","event":"E2"}`,
    ]);
  });

  it("dedups a live file re-read with identical content (no spurious re-emit)", () => {
    const c = collector();
    const w = new JournalWatcher({ dir, emit: c.emit });
    writeFileSync(join(dir, "Status.json"), `{"Flags":1}`);
    w.tick();
    // Rewrite with byte-identical content (fresh mtime) — must NOT re-emit.
    writeFileSync(join(dir, "Status.json"), `{"Flags":1}`);
    w.tick();
    expect(c.events.filter((e) => e.source === "live-file")).toHaveLength(1);
  });

  it("emits a live-status file on change, and again when it is rewritten", () => {
    writeFileSync(join(dir, "Journal.2025-06-01T120000.01.log"), line(1));
    const c = collector();
    const w = new JournalWatcher({ dir, emit: c.emit });
    writeFileSync(join(dir, "Status.json"), `{"Flags":1,"n":1}`);
    w.tick();
    const live1 = c.events.filter((e) => e.source === "live-file");
    expect(live1).toHaveLength(1);
    expect(live1[0]).toMatchObject({ source: "live-file", name: "Status.json" });
    // Unchanged mtime → no re-emit.
    w.tick();
    expect(c.events.filter((e) => e.source === "live-file")).toHaveLength(1);
    // Rewrite with a new mtime → re-emit.
    writeFileSync(join(dir, "Status.json"), `{"Flags":16,"n":2}`);
    w.tick();
    expect(c.events.filter((e) => e.source === "live-file")).toHaveLength(2);
  });

  it("does NOT emit a live file that is mid-write (unparseable JSON); emits once complete", () => {
    const c = collector();
    const w = new JournalWatcher({ dir, emit: c.emit });
    writeFileSync(join(dir, "Cargo.json"), `{"Count":10,"Inv`); // partial write
    w.tick();
    expect(c.events.filter((e) => e.source === "live-file")).toHaveLength(0);
    writeFileSync(join(dir, "Cargo.json"), `{"Count":10,"Inventory":[]}`); // completed
    w.tick();
    expect(c.events.filter((e) => e.source === "live-file")).toHaveLength(1);
  });
});

describe("JournalWatcher — resilience (injected failing ports)", () => {
  function warnSpy(): WatcherLogger & { calls: string[] } {
    const calls: string[] = [];
    return { warn: (msg) => calls.push(msg), calls };
  }

  it("logs and continues (never throws) when the active journal poll fails", () => {
    const logger = warnSpy();
    const c = collector();
    const fs: WatcherFs = {
      readdir: () => ["Journal.2025-06-01T120000.01.log"],
      statMtimeMs: () => null,
      readFile: () => "",
    };
    const w = new JournalWatcher({
      dir: "/x",
      emit: c.emit,
      logger,
      fs,
      makeTailer: () => ({
        position: 0,
        poll: (): TailLine[] => {
          throw new Error("EBUSY");
        },
      }),
    });
    expect(() => {
      w.tick();
    }).not.toThrow();
    expect(logger.calls).toContain("journal.poll-failed");
  });

  it("logs and continues when a live file read fails (EBUSY/lock)", () => {
    const logger = warnSpy();
    const c = collector();
    const fs: WatcherFs = {
      readdir: () => [],
      statMtimeMs: (p) => (p.endsWith("Status.json") ? 123 : null),
      readFile: () => {
        throw new Error("EBUSY");
      },
    };
    const w = new JournalWatcher({ dir: "/x", emit: c.emit, logger, fs });
    expect(() => {
      w.tick();
    }).not.toThrow();
    expect(logger.calls).toContain("livefile.read-failed");
    expect(c.events).toHaveLength(0);
  });

  it("compareJournals orders by timestamp then numeric part (old before new, .100 after .99)", () => {
    const files = [
      "Journal.2025-06-01T120000.99.log",
      "Journal.2025-06-01T120000.100.log",
      "Journal.2025-06-01T120000.01.log",
      "Journal.190101120000.01.log",
    ];
    expect([...files].sort(compareJournals)).toEqual([
      "Journal.190101120000.01.log",
      "Journal.2025-06-01T120000.01.log",
      "Journal.2025-06-01T120000.99.log",
      "Journal.2025-06-01T120000.100.log",
    ]);
  });

  it("start() runs the poll loop on an interval and stop() halts it (no leaked timer)", () => {
    vi.useFakeTimers();
    try {
      const c = collector();
      const readdir = vi.fn((): string[] => []);
      const fs: WatcherFs = { readdir, statMtimeMs: () => null, readFile: () => "" };
      const w = new JournalWatcher({ dir: "/x", emit: c.emit, fs, pollIntervalMs: 100 });
      w.start(); // one immediate tick + the interval
      const afterStart = readdir.mock.calls.length;
      expect(afterStart).toBeGreaterThanOrEqual(1);
      vi.advanceTimersByTime(350); // ~3 more ticks
      expect(readdir.mock.calls.length).toBeGreaterThan(afterStart);
      w.stop();
      const afterStop = readdir.mock.calls.length;
      vi.advanceTimersByTime(500);
      expect(readdir.mock.calls.length).toBe(afterStop); // stopped — no further ticks
    } finally {
      vi.useRealTimers();
    }
  });
});
