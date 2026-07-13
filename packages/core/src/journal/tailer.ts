/**
 * Incremental JSONL tailer (SSOT Step 1.2). Pure line-assembly logic over an
 * injected FileSource so it can be exhaustively tested without real files.
 *
 * Line splitting is done in BYTES (on 0x0A) — a UTF-8 continuation byte is always
 * >= 0x80, so a newline byte can never be part of a multi-byte character, which
 * keeps byte offsets exact and decoding correct per line. A partial trailing line
 * (no newline yet) is buffered and never emitted early. A leading UTF-8 BOM on the
 * first line is stripped. JSON validity is NOT the tailer's concern — malformed
 * lines are emitted raw and the parsers (Step 1.5) reject them.
 *
 * The file can change out from under us. Three defenses, in order of cost:
 *   1. size regression (`size < consumed`) → truncated → reset.
 *   2. identity change (`id` differs) → replaced → reset.
 *   3. a content anchor: before reading new bytes we re-verify a small window of
 *      already-consumed bytes is unchanged. On NTFS an in-place truncate+regrow or
 *      a same-path O_TRUNC overwrite keeps `ino`/`birthtimeMs` AND can end up
 *      larger than the old offset, so (1) and (2) both miss it — the anchor does
 *      not. Ordinary appends never touch already-consumed bytes, so no false reset.
 */

import { closeSync, openSync, readSync, statSync } from "node:fs";

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const BOM = [0xef, 0xbb, 0xbf] as const;
/** Cap per-poll reads so an initial multi-MB backfill can't do one giant synchronous main-process read. */
const MAX_READ_BYTES = 4 * 1024 * 1024;
/** How many trailing consumed bytes to re-verify each poll as the change anchor. */
const ANCHOR_BYTES = 256;

export interface TailLine {
  readonly file: string;
  /** Byte offset in the file where this line begins (BOM included if first line). */
  readonly byteOffset: number;
  /** Line content, without the trailing newline/CR and without a leading BOM. */
  readonly raw: string;
}

export interface FileSnapshot {
  readonly size: number;
  /**
   * File identity. A different value means the file was replaced. NOTE the
   * converse does NOT hold: an in-place truncate+regrow or O_TRUNC overwrite can
   * keep this stable on NTFS — the tailer's content anchor covers that residual.
   */
  readonly id: string;
}

export interface FileSource {
  /** Current size + identity, or null if the file does not exist. */
  stat(): FileSnapshot | null;
  /** Read up to `length` bytes starting at `start` (may return fewer at EOF). */
  read(start: number, length: number): Buffer;
}

export interface TailerOptions {
  /**
   * Resume from a persisted byte offset (default 0). This MUST be a value read
   * from `Tailer.position` — always a line boundary — never an arbitrary offset.
   */
  readonly startOffset?: number;
}

export class Tailer {
  private consumed: number;
  private pending: Buffer = Buffer.alloc(0);
  private anchor: Buffer = Buffer.alloc(0);
  private fileId: string | undefined;

  constructor(
    private readonly file: string,
    private readonly source: FileSource,
    opts: TailerOptions = {},
  ) {
    this.consumed = opts.startOffset ?? 0;
  }

  /**
   * The byte offset up to which whole lines have been emitted (always a line
   * boundary). Persist THIS to resume safely — never the in-flight partial line.
   */
  get position(): number {
    return this.consumed - this.pending.length;
  }

  /** Read all bytes appended since the last poll and return the newly-completed lines. */
  poll(): TailLine[] {
    const stat = this.source.stat();
    if (stat === null) return [];
    const replaced = this.fileId !== undefined && stat.id !== this.fileId;
    if (replaced || stat.size < this.consumed) this.reset();
    this.fileId = stat.id;
    if (stat.size <= this.consumed) return [];
    // About to read new bytes — make sure what we already consumed hasn't been
    // rewritten underneath us (truncate+regrow / same-id overwrite).
    if (this.consumed > 0 && this.anchor.length > 0 && !this.anchorIntact()) this.reset();
    const length = Math.min(stat.size - this.consumed, MAX_READ_BYTES);
    const chunk = this.source.read(this.consumed, length);
    if (chunk.length === 0) return [];
    return this.consume(chunk);
  }

  private reset(): void {
    this.consumed = 0;
    this.pending = Buffer.alloc(0);
    this.anchor = Buffer.alloc(0);
  }

  private anchorIntact(): boolean {
    const at = this.consumed - this.anchor.length;
    const check = this.source.read(at, this.anchor.length);
    return check.length === this.anchor.length && check.equals(this.anchor);
  }

  private consume(chunk: Buffer): TailLine[] {
    const lines: TailLine[] = [];
    const base = this.consumed - this.pending.length; // file offset of combined[0]
    const combined = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    let start = 0;
    for (let i = 0; i < combined.length; i++) {
      if (combined[i] !== NEWLINE) continue;
      lines.push(this.makeLine(combined, start, i, base));
      start = i + 1;
    }
    this.pending =
      start < combined.length ? Buffer.from(combined.subarray(start)) : Buffer.alloc(0);
    this.consumed += chunk.length;
    this.updateAnchor(chunk);
    return lines;
  }

  private updateAnchor(chunk: Buffer): void {
    const tail = this.anchor.length === 0 ? chunk : Buffer.concat([this.anchor, chunk]);
    this.anchor =
      tail.length > ANCHOR_BYTES ? Buffer.from(tail.subarray(tail.length - ANCHOR_BYTES)) : tail;
  }

  private makeLine(buf: Buffer, start: number, newlineIndex: number, base: number): TailLine {
    let end = newlineIndex;
    if (end > start && buf[end - 1] === CARRIAGE_RETURN) end -= 1; // strip trailing CR (CRLF)
    let contentStart = start;
    const byteOffset = base + start;
    if (
      byteOffset === 0 &&
      end - contentStart >= 3 &&
      buf[contentStart] === BOM[0] &&
      buf[contentStart + 1] === BOM[1] &&
      buf[contentStart + 2] === BOM[2]
    ) {
      contentStart += 3; // strip a UTF-8 BOM, first line only
    }
    return { file: this.file, byteOffset, raw: buf.toString("utf8", contentStart, end) };
  }
}

/** A FileSource backed by real filesystem reads (used by the Step 1.3 watcher). */
export function nodeFileSource(path: string): FileSource {
  return {
    stat(): FileSnapshot | null {
      try {
        const s = statSync(path);
        return {
          size: s.size,
          id: `${String(s.dev)}:${String(s.ino)}:${String(Math.round(s.birthtimeMs))}`,
        };
      } catch {
        return null;
      }
    },
    read(start: number, length: number): Buffer {
      const fd = openSync(path, "r");
      try {
        const buf = Buffer.alloc(length);
        const bytesRead = readSync(fd, buf, 0, length, start);
        return buf.subarray(0, bytesRead);
      } finally {
        closeSync(fd);
      }
    },
  };
}
