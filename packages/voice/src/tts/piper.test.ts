import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gzipSync, zipSync } from "fflate";
import { domainError, err, ok } from "@lodestar/shared";
import type { DomainError, Result } from "@lodestar/shared";
import { createNodeRunPiper, ensureInstalled, isWav, synthesize } from "./piper.js";
import type { ArtifactFetcher, PiperFs, PiperInstall, RunPiper, SpawnPiper } from "./piper.js";
import { DEFAULT_VOICE_ID, PIPER_BINARY, PIPER_EXE_PATH, VOICES } from "./piper-assets.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]); // RIFF…WAVE

/** A minimal USTAR archive of regular files (for the voice .tar.gz fixture). */
function makeTar(files: Record<string, Uint8Array>): Uint8Array {
  const e = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const [name, data] of Object.entries(files)) {
    const header = new Uint8Array(512);
    header.set(e.encode(name), 0);
    header.set(e.encode(data.length.toString(8).padStart(11, "0") + "\0"), 124);
    header[156] = 0x30;
    blocks.push(
      header,
      ((): Uint8Array => {
        const p = new Uint8Array(Math.ceil(data.length / 512) * 512);
        p.set(data);
        return p;
      })(),
    );
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let o = 0;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

function memFs(): { files: Map<string, Uint8Array>; fs: PiperFs } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    fs: {
      exists: (p) => files.has(p),
      writeFile: (p, b) => {
        files.set(p, b);
      },
    },
  };
}

const VOICE = VOICES[DEFAULT_VOICE_ID];
if (VOICE === undefined) throw new Error("default voice missing from the manifest");

const PIPER_ZIP = zipSync({
  "piper/piper.exe": enc("EXE"),
  "piper/onnxruntime.dll": enc("DLL"),
});
const VOICE_TARGZ = gzipSync(
  makeTar({ [VOICE.modelFile]: enc("MODEL"), [VOICE.configFile]: enc('{"audio":{}}') }),
);

/** A fetcher that serves the fflate-built archives for the pinned URLs. */
const goodFetch: ArtifactFetcher = (artifact) => {
  if (artifact.url === PIPER_BINARY.url) return Promise.resolve(ok(PIPER_ZIP));
  if (artifact.url === VOICE.archive.url) return Promise.resolve(ok(VOICE_TARGZ));
  return Promise.resolve(err(domainError("test.no-artifact", artifact.url)));
};

const DIR = "C:/lodestar/voices";

describe("piper client — ensureInstalled", () => {
  it("downloads + extracts the binary and voice on first run", async () => {
    const { files, fs } = memFs();
    const r = await ensureInstalled({ dir: DIR, download: goodFetch, fs });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.exePath).toBe(join(DIR, PIPER_EXE_PATH));
      expect(r.value.modelPath).toBe(join(DIR, VOICE.modelFile));
      expect(r.value.voiceId).toBe(DEFAULT_VOICE_ID);
    }
    expect(files.has(join(DIR, "piper/piper.exe"))).toBe(true);
    expect(files.has(join(DIR, "piper/onnxruntime.dll"))).toBe(true); // DLLs extracted too
    expect(files.has(join(DIR, VOICE.modelFile))).toBe(true);
    expect(files.has(join(DIR, VOICE.configFile))).toBe(true);
  });

  it("skips downloading when the completion markers are present", async () => {
    const { files, fs } = memFs();
    files.set(join(DIR, "piper", ".installed"), new Uint8Array(0));
    files.set(join(DIR, `${DEFAULT_VOICE_ID}.installed`), new Uint8Array(0));
    let fetched = 0;
    const counting: ArtifactFetcher = (a) => {
      fetched += 1;
      return goodFetch(a);
    };
    const r = await ensureInstalled({ dir: DIR, download: counting, fs });
    expect(r.ok).toBe(true);
    expect(fetched).toBe(0); // markers present → nothing downloaded
  });

  it("refuses a zip entry that escapes the install dir (zip-slip)", async () => {
    const { files, fs } = memFs();
    const evilZip = zipSync({ "../../../evil.dll": enc("PWNED") });
    const download: ArtifactFetcher = (a) =>
      a.url === PIPER_BINARY.url ? Promise.resolve(ok(evilZip)) : Promise.resolve(ok(VOICE_TARGZ));
    const r = await ensureInstalled({ dir: DIR, download, fs });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("piper.unsafe-entry");
    // Nothing was written outside (or anywhere) — the guard fired before the write.
    expect([...files.keys()].some((k) => k.includes("evil.dll"))).toBe(false);
  });

  it("rejects an unknown voice id", async () => {
    const { fs } = memFs();
    const r = await ensureInstalled({
      dir: DIR,
      voiceId: "en_GB-nope-medium",
      download: goodFetch,
      fs,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("piper.unknown-voice");
  });

  it("propagates a download failure (e.g. a hash mismatch upstream)", async () => {
    const { fs } = memFs();
    const failing: ArtifactFetcher = () =>
      Promise.resolve(err(domainError("downloader.hash-mismatch", "bad")));
    const r = await ensureInstalled({ dir: DIR, download: failing, fs });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("downloader.hash-mismatch");
  });

  it("fails if the voice archive is missing its model/config entries", async () => {
    const { fs } = memFs();
    const emptyTar = gzipSync(makeTar({ "README.txt": enc("x") }));
    const fetch: ArtifactFetcher = (a) =>
      a.url === PIPER_BINARY.url ? Promise.resolve(ok(PIPER_ZIP)) : Promise.resolve(ok(emptyTar));
    const r = await ensureInstalled({ dir: DIR, download: fetch, fs });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("piper.archive-incomplete");
  });
});

describe("piper client — synthesize", () => {
  const install: PiperInstall = {
    exePath: "p.exe",
    modelPath: "m.onnx",
    voiceId: DEFAULT_VOICE_ID,
  };

  it("returns the WAV bytes when piper produces valid audio", async () => {
    const run: RunPiper = () => Promise.resolve(ok(WAV));
    const r = await synthesize("Platinum, mine.", install, run);
    expect(r.ok).toBe(true);
    if (r.ok) expect(isWav(r.value)).toBe(true);
  });

  it("refuses empty text without invoking piper", async () => {
    let called = false;
    const run: RunPiper = () => {
      called = true;
      return Promise.resolve(ok(WAV));
    };
    const r = await synthesize("   ", install, run);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("piper.empty-text");
    expect(called).toBe(false);
  });

  it("surfaces a run failure", async () => {
    const run: RunPiper = () => Promise.resolve(err(domainError("piper.exit", "exited 1")));
    const r = await synthesize("hi", install, run);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("piper.exit");
  });

  it("rejects non-WAV output (a truncated/garbage synthesis)", async () => {
    const run: RunPiper = () =>
      Promise.resolve(ok(new Uint8Array([1, 2, 3, 4])) as Result<Uint8Array, DomainError>);
    const r = await synthesize("hi", install, run);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("piper.bad-output");
  });

  it("isWav detects the RIFF magic and rejects short/garbage buffers", () => {
    expect(isWav(WAV)).toBe(true);
    expect(isWav(new Uint8Array([0x52, 0x49]))).toBe(false);
    expect(isWav(new Uint8Array(12))).toBe(false);
  });
});

/** A child that the fake spawn drives: it "is" piper writing a WAV to --output_file. */
class FakeChild extends EventEmitter {
  stdinData = "";
  ended = false;
  readonly stdin = {
    write: (s: string) => {
      this.stdinData += s;
    },
    end: () => {
      this.ended = true;
    },
  };
  readonly stderr = new EventEmitter();
}

function fakeSpawn(behavior: "ok" | "exit1" | "spawnError"): SpawnPiper {
  return (_exe, args) => {
    const child = new FakeChild();
    const outFile = args[args.indexOf("--output_file") + 1] ?? "";
    // Defer so the adapter has attached its listeners + written stdin first.
    queueMicrotask(() => {
      if (behavior === "spawnError") {
        child.emit("error", new Error("ENOENT"));
        return;
      }
      if (behavior === "ok") {
        writeFileSync(outFile, Buffer.from(WAV)); // simulate piper writing the WAV file
        child.emit("close", 0);
        return;
      }
      child.stderr.emit("data", Buffer.from("piper: model load failed"));
      child.emit("close", 1);
    });
    return child;
  };
}

describe("createNodeRunPiper (node adapter)", () => {
  it("spawns piper, feeds stdin, reads the produced WAV, and cleans up", async () => {
    const run = createNodeRunPiper(fakeSpawn("ok"));
    const r = await run("piper.exe", "model.onnx", "hello");
    expect(r.ok).toBe(true);
    if (r.ok) expect(isWav(r.value)).toBe(true);
  });

  it("returns an error when piper exits non-zero", async () => {
    const r = await createNodeRunPiper(fakeSpawn("exit1"))("p", "m", "hi");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("piper.exit");
  });

  it("returns an error when the process fails to spawn", async () => {
    const r = await createNodeRunPiper(fakeSpawn("spawnError"))("p", "m", "hi");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("piper.spawn-failed");
  });
});

// The true end-to-end proof (SSOT §2.7b acceptance). Runs only where the real Piper
// binary + voice are present (this dev machine, the operator's install); skipped in
// CI. Point it at the downloaded assets via LODESTAR_PIPER_EXE / LODESTAR_PIPER_MODEL.
const REAL_EXE = process.env["LODESTAR_PIPER_EXE"] ?? "";
const REAL_MODEL = process.env["LODESTAR_PIPER_MODEL"] ?? "";
const HAS_REAL =
  REAL_EXE !== "" && REAL_MODEL !== "" && existsSync(REAL_EXE) && existsSync(REAL_MODEL);

describe.skipIf(!HAS_REAL)("piper real-binary integration", () => {
  it("synthesizes a real WAV from the pinned Piper binary + voice", async () => {
    const install: PiperInstall = {
      exePath: REAL_EXE,
      modelPath: REAL_MODEL,
      voiceId: DEFAULT_VOICE_ID,
    };
    const r = await synthesize(
      "Platinum, thirty-two percent. Mine.",
      install,
      createNodeRunPiper(),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(isWav(r.value)).toBe(true);
      expect(r.value.byteLength).toBeGreaterThan(1000); // real audio, not an empty header
    }
  }, 30_000);
});
