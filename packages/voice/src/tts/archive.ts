/**
 * Archive extraction for the Piper install (SSOT Step 2.7b). The Piper Windows
 * release is a `.zip` (piper.exe + DLLs + espeak-ng-data); the voice model ships
 * as a `.tar.gz` (`.onnx` + `.onnx.json`). Both are extracted in pure JS via
 * `fflate` (zip + gzip) plus a minimal USTAR reader — no native tools or shell-out,
 * so extraction is deterministic and cross-platform-testable. Each returns a
 * path → bytes map; the caller writes the entries it wants to disk.
 */

import { gunzipSync, unzipSync } from "fflate";

/** Extract a ZIP into a `path → bytes` map (directory entries are dropped). */
export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const entries = unzipSync(bytes);
  const out = new Map<string, Uint8Array>();
  for (const [path, data] of Object.entries(entries)) {
    if (path.endsWith("/")) continue; // a directory entry, not a file
    out.set(path, data);
  }
  return out;
}

/** Extract a gzip'd TAR into a `path → bytes` map (regular files only). */
export function untarGz(bytes: Uint8Array): Map<string, Uint8Array> {
  return readTar(gunzipSync(bytes));
}

const BLOCK = 512;

function readTar(buf: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  const field = (start: number, len: number): string =>
    dec
      .decode(buf.subarray(start, start + len))
      .replace(/\0[\s\S]*$/, "")
      .trim();

  let off = 0;
  while (off + BLOCK <= buf.length) {
    const name = field(off, 100);
    if (name === "") break; // the trailing zero block(s) mark end-of-archive
    const size = Number.parseInt(field(off + 124, 12) || "0", 8);
    // A malformed (negative / non-integer) size would make `off` stall or scan
    // backward — stop rather than hang (these are untrusted bytes despite the pin).
    if (!Number.isSafeInteger(size) || size < 0) break;
    const type = buf[off + 156] ?? 0;
    off += BLOCK;
    // Type '0' (0x30) or NUL is a regular file; directories ('5') and metadata
    // entries (GNU longname 'L', pax 'x'/'g', …) carry no payload we need.
    if (type === 0x30 || type === 0) {
      files.set(name, buf.subarray(off, off + size));
    }
    off += Math.ceil(size / BLOCK) * BLOCK; // data is padded to a 512-byte boundary
  }
  return files;
}
