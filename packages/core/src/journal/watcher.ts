/**
 * Journal watcher + session-file selection (SSOT Step 1.3). One deterministic
 * poll cycle (`tick`) does everything: pick the newest `Journal.*.log`, backfill
 * it from the start via the Step 1.2 tailer, switch to a rotated-in newer file
 * (draining the outgoing one first so no trailing line is lost), and re-read the
 * §5.2 live status files when their mtime changes (gated on JSON completeness so a
 * mid-write partial file is retried, not emitted).
 *
 * DIVERGENCE from the original SSOT text (chokidar for rotation/live files): a
 * unified 100 ms poll covers rotation (directory listing) and live files (mtime)
 * as well as the active-journal tail. It meets the same ≤250 ms p95 latency budget,
 * drops the chokidar dependency, and — crucially — makes the watcher deterministic
 * and its integration tests reproducible (driven by explicit `tick()` calls, not
 * flaky filesystem-event timing). All emissions go to an injected sink; the typed
 * event bus (Step 1.4) is wired in there.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Tailer, nodeFileSource } from "./tailer.js";
import type { TailLine } from "./tailer.js";

export type LiveFileName =
  "Status.json" | "Cargo.json" | "Market.json" | "NavRoute.json" | "ModulesInfo.json";

export type WatcherEvent =
  | {
      readonly source: "journal";
      readonly file: string;
      readonly byteOffset: number;
      readonly raw: string;
    }
  | {
      readonly source: "live-file";
      readonly name: LiveFileName;
      readonly raw: string;
      readonly mtimeMs: number;
    };

export interface WatcherLogger {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

/** Minimal tailer surface the watcher drives (injectable for resilience tests). */
export interface TailerLike {
  poll(): TailLine[];
}

/** Filesystem port (defaults to real fs; injectable so error paths are testable). */
export interface WatcherFs {
  readdir(dir: string): string[];
  /** Modification time in ms, or null if the file does not exist. */
  statMtimeMs(path: string): number | null;
  readFile(path: string): string;
}

export interface JournalWatcherOptions {
  readonly dir: string;
  readonly emit: (event: WatcherEvent) => void;
  readonly logger?: WatcherLogger;
  readonly pollIntervalMs?: number;
  readonly fs?: WatcherFs;
  readonly makeTailer?: (name: string, path: string) => TailerLike;
}

export const LIVE_FILES: readonly LiveFileName[] = [
  "Status.json",
  "Cargo.json",
  "Market.json",
  "NavRoute.json",
  "ModulesInfo.json",
];

const JOURNAL_PATTERN = /^Journal\..*\.log$/;

export function nodeWatcherFs(): WatcherFs {
  return {
    readdir: (dir) => {
      try {
        return readdirSync(dir);
      } catch {
        return [];
      }
    },
    statMtimeMs: (path) => {
      try {
        return statSync(path).mtimeMs;
      } catch {
        return null;
      }
    },
    readFile: (path) => readFileSync(path, "utf8"),
  };
}

/**
 * Order journal files chronologically. The timestamp segment sorts correctly
 * lexicographically (ISO and legacy numeric both — '1'<'2' keeps old sessions
 * before new), but the rotation PART must be compared numerically so `.100` does
 * not sort before `.99`.
 */
export function compareJournals(a: string, b: string): number {
  const key = (name: string): [string, number] => {
    const m = /^Journal\.(.+)\.(\d+)\.log$/.exec(name);
    return m === null ? [name, 0] : [m[1] ?? "", Number(m[2] ?? 0)];
  };
  const [ta, pa] = key(a);
  const [tb, pb] = key(b);
  if (ta < tb) return -1;
  if (ta > tb) return 1;
  return pa - pb;
}

export class JournalWatcher {
  private active: { name: string; tailer: TailerLike } | undefined;
  private readonly liveContent = new Map<LiveFileName, string>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly fs: WatcherFs;
  private readonly makeTailer: (name: string, path: string) => TailerLike;

  constructor(private readonly opts: JournalWatcherOptions) {
    this.fs = opts.fs ?? nodeWatcherFs();
    this.makeTailer = opts.makeTailer ?? ((name, path) => new Tailer(name, nodeFileSource(path)));
  }

  /** One scan + poll cycle. Deterministic — tests call this directly. */
  tick(): void {
    this.rotateIfNeeded();
    this.drainActive();
    this.pollLiveFiles();
  }

  /** Start the 100 ms poll loop (one immediate tick, then on the interval). */
  start(): void {
    this.tick();
    this.timer = setInterval(() => {
      this.tick();
    }, this.opts.pollIntervalMs ?? 100);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private listJournals(): string[] {
    return this.fs
      .readdir(this.opts.dir)
      .filter((f) => JOURNAL_PATTERN.test(f))
      .sort(compareJournals);
  }

  private switchTo(name: string): void {
    this.active = { name, tailer: this.makeTailer(name, join(this.opts.dir, name)) };
  }

  private rotateIfNeeded(): void {
    const journals = this.listJournals();
    const newest = journals.at(-1);
    if (newest === undefined) return;
    if (this.active === undefined) {
      this.switchTo(newest); // cold start: newest only, never replay old sessions
      return;
    }
    if (this.active.name === newest) return;
    const activeIdx = journals.indexOf(this.active.name);
    // If the active file vanished, jump to newest (don't replay history). Otherwise
    // walk EVERY file after it in order, draining each before advancing, so two
    // rotations landing in one tick can't skip an intermediate file's events.
    const successors = activeIdx === -1 ? [newest] : journals.slice(activeIdx + 1);
    for (const name of successors) {
      this.drainActive(); // flush the outgoing file's tail before switching
      this.switchTo(name);
    }
  }

  private drainActive(): void {
    if (this.active === undefined) return;
    try {
      for (const l of this.active.tailer.poll()) {
        this.opts.emit({ source: "journal", file: l.file, byteOffset: l.byteOffset, raw: l.raw });
      }
    } catch (error) {
      this.opts.logger?.warn("journal.poll-failed", {
        file: this.active.name,
        error: String(error),
      });
    }
  }

  private pollLiveFiles(): void {
    for (const name of LIVE_FILES) {
      const path = join(this.opts.dir, name);
      // Read every tick that the file exists and dedup on CONTENT, never on mtime:
      // the game rewrites these non-atomically and coarse/coalesced mtimes could
      // otherwise strand stale telemetry as "current" indefinitely. These files are
      // small (Status/Cargo/NavRoute/ModulesInfo tiny; Market.json bounded).
      const mtimeMs = this.fs.statMtimeMs(path);
      if (mtimeMs === null) continue; // not present
      let raw: string;
      try {
        raw = this.fs.readFile(path);
      } catch (error) {
        this.opts.logger?.warn("livefile.read-failed", { name, error: String(error) });
        continue; // EBUSY / lock — retry next tick
      }
      if (this.liveContent.get(name) === raw) continue; // unchanged — dedup
      if (!isCompleteJson(raw)) continue; // mid-write partial — retry next tick (not cached)
      this.liveContent.set(name, raw);
      this.opts.emit({ source: "live-file", name, raw, mtimeMs });
    }
  }
}

function isCompleteJson(raw: string): boolean {
  try {
    JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}
