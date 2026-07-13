import { describe, expect, it } from "vitest";
import { gzipSync, zipSync } from "fflate";
import { untarGz, unzip } from "./archive.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Build a minimal USTAR archive (regular-file entries) for the round-trip test. */
function makeTar(files: Record<string, Uint8Array>): Uint8Array {
  const e = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const [name, data] of Object.entries(files)) {
    const header = new Uint8Array(512);
    header.set(e.encode(name), 0);
    header.set(e.encode(data.length.toString(8).padStart(11, "0") + "\0"), 124); // size @124
    header[156] = 0x30; // type '0' = regular file
    blocks.push(header);
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024)); // two zero blocks = end-of-archive
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

describe("archive extraction", () => {
  it("unzips a ZIP into a path → bytes map, dropping directory entries", () => {
    const zip = zipSync({
      "piper/piper.exe": enc("EXE-BYTES"),
      "piper/espeak-ng-data/en_dict": enc("dict"),
    });
    const files = unzip(zip);
    expect(dec(files.get("piper/piper.exe") ?? new Uint8Array())).toBe("EXE-BYTES");
    expect(dec(files.get("piper/espeak-ng-data/en_dict") ?? new Uint8Array())).toBe("dict");
    // No trailing-slash directory keys leak through.
    expect([...files.keys()].some((k) => k.endsWith("/"))).toBe(false);
  });

  it("extracts a .tar.gz into a path → bytes map (regular files, nested paths)", () => {
    const onnx = new Uint8Array([1, 2, 3, 4, 5]);
    const tarGz = gzipSync(
      makeTar({
        "en-us-ryan-high.onnx": onnx,
        "en-us-ryan-high.onnx.json": enc('{"audio":{"sample_rate":22050}}'),
      }),
    );
    const files = untarGz(tarGz);
    expect(files.get("en-us-ryan-high.onnx")).toEqual(onnx);
    expect(dec(files.get("en-us-ryan-high.onnx.json") ?? new Uint8Array())).toContain("22050");
  });

  it("round-trips a payload spanning multiple 512-byte tar blocks", () => {
    const big = new Uint8Array(1300).map((_, i) => i % 256); // > 2 blocks
    const files = untarGz(gzipSync(makeTar({ "model.onnx": big })));
    expect(files.get("model.onnx")).toEqual(big);
  });

  it("drops a zip directory entry (trailing-slash key)", () => {
    const zip = zipSync({ "piper/": new Uint8Array(0), "piper/piper.exe": enc("EXE") });
    const files = unzip(zip);
    expect(files.has("piper/")).toBe(false); // directory entry skipped
    expect(files.has("piper/piper.exe")).toBe(true);
  });

  it("terminates safely on a tar with a malformed negative size (never hangs)", () => {
    const e = new TextEncoder();
    const header = new Uint8Array(512);
    header.set(e.encode("evil"), 0);
    header.set(e.encode("-0001130\0"), 124); // negative octal size
    header[156] = 0x30;
    const tar = new Uint8Array(512 + 1024);
    tar.set(header, 0);
    const files = untarGz(gzipSync(tar));
    expect(files.has("evil")).toBe(false); // stopped rather than looping/scanning backward
  });

  it("skips tar directory entries (type '5') and keeps NUL-type files", () => {
    // A hand-built tar: a directory entry (type '5', no payload) + a NUL-type file.
    const e = new TextEncoder();
    const dir = new Uint8Array(512);
    dir.set(e.encode("voice/"), 0);
    dir.set(e.encode("00000000000\0"), 124);
    dir[156] = 0x35; // '5' = directory
    const fileHdr = new Uint8Array(512);
    fileHdr.set(e.encode("voice/card"), 0);
    fileHdr.set(e.encode((3).toString(8).padStart(11, "0") + "\0"), 124);
    fileHdr[156] = 0; // NUL type = regular file (legacy)
    const data = new Uint8Array(512);
    data.set(e.encode("abc"));
    const tar = new Uint8Array(512 * 3 + 1024);
    tar.set(dir, 0);
    tar.set(fileHdr, 512);
    tar.set(data, 1024);
    const files = untarGz(gzipSync(tar));
    expect(files.has("voice/")).toBe(false); // directory skipped
    expect(dec(files.get("voice/card") ?? new Uint8Array())).toBe("abc"); // NUL-type kept
  });
});
