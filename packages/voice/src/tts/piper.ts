/**
 * Piper TTS client (SSOT Step 2.7b). CPU-only text→WAV via the pinned Piper
 * binary + voice model (piper-assets.ts). `ensureInstalled` downloads (hash-
 * verified, via the injected fetcher) + extracts (archive.ts) the binary and the
 * chosen voice on first run; `synthesize` runs piper one-shot (text on stdin →
 * WAV) and validates the output. Download/extract/run/fs are all injected so the
 * logic is unit-testable offline; `createNodeRunPiper` is the real child-process
 * adapter used by the desktop main. No GPU flags — TTS is CPU.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";
import { untarGz, unzip } from "./archive.js";
import { DEFAULT_VOICE_ID, PIPER_BINARY, PIPER_EXE_PATH, VOICES } from "./piper-assets.js";
import type { PinnedArtifact } from "./piper-assets.js";

/** Downloads a hash-verified artifact (the desktop main wraps the integrations downloader). */
export type ArtifactFetcher = (
  artifact: PinnedArtifact,
) => Promise<Result<Uint8Array, DomainError>>;

/** Minimal filesystem port (real impl = node:fs; tests inject an in-memory map). */
export interface PiperFs {
  exists(path: string): boolean;
  /** Write bytes, creating parent directories as needed. */
  writeFile(path: string, bytes: Uint8Array): void;
}

/** The real node:fs adapter for {@link PiperFs} (creates parent dirs on write). */
export function createNodePiperFs(): PiperFs {
  return {
    exists: (path) => existsSync(path),
    writeFile: (path, bytes) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    },
  };
}

/** Spawns piper one-shot: feeds `text` on stdin, resolves the produced WAV bytes. */
export type RunPiper = (
  exePath: string,
  modelPath: string,
  text: string,
) => Promise<Result<Uint8Array, DomainError>>;

export interface PiperInstall {
  readonly exePath: string;
  readonly modelPath: string;
  readonly voiceId: string;
}

export interface EnsureInstalledOptions {
  /** Install root (e.g. `%APPDATA%/lodestar/voices`). */
  readonly dir: string;
  readonly voiceId?: string;
  /** Hash-verified artifact download (the desktop main wraps the integrations downloader). */
  readonly download: ArtifactFetcher;
  readonly fs: PiperFs;
}

/** Ensure piper.exe + the chosen voice are present (download + extract on first run). */
export async function ensureInstalled(
  opts: EnsureInstalledOptions,
): Promise<Result<PiperInstall, DomainError>> {
  const voiceId = opts.voiceId ?? DEFAULT_VOICE_ID;
  const voice = VOICES[voiceId];
  if (voice === undefined) {
    return err(domainError("piper.unknown-voice", `No pinned voice "${voiceId}"`));
  }
  const exePath = join(opts.dir, PIPER_EXE_PATH);
  const modelPath = join(opts.dir, voice.modelFile);
  // Completion markers written only after a FULL extraction, so a crash mid-extract
  // (a half-written binary dir) re-downloads next run instead of spawning broken.
  const binaryMarker = join(opts.dir, "piper", ".installed");
  const voiceMarker = join(opts.dir, `${voiceId}.installed`);

  if (!opts.fs.exists(binaryMarker)) {
    const dl = await opts.download(PIPER_BINARY);
    if (!dl.ok) return err(dl.error);
    for (const [path, bytes] of unzip(dl.value)) {
      const dest = join(opts.dir, path);
      // Zip-slip guard: an archive-controlled entry name must never escape the
      // install dir (defense-in-depth beyond the SHA-256 pin).
      const rel = relative(opts.dir, dest);
      if (rel === "" || rel.split(sep)[0] === ".." || isAbsolute(rel)) {
        return err(
          domainError(
            "piper.unsafe-entry",
            `Refusing archive entry outside the install dir: ${path}`,
          ),
        );
      }
      opts.fs.writeFile(dest, bytes);
    }
    opts.fs.writeFile(binaryMarker, new Uint8Array(0));
  }
  if (!opts.fs.exists(voiceMarker)) {
    const dl = await opts.download(voice.archive);
    if (!dl.ok) return err(dl.error);
    const files = untarGz(dl.value);
    const model = files.get(voice.modelFile);
    const config = files.get(voice.configFile);
    if (model === undefined || config === undefined) {
      return err(
        domainError(
          "piper.archive-incomplete",
          `Voice archive missing ${voice.modelFile} or its config`,
        ),
      );
    }
    opts.fs.writeFile(modelPath, model);
    opts.fs.writeFile(join(opts.dir, voice.configFile), config);
    opts.fs.writeFile(voiceMarker, new Uint8Array(0));
  }
  return ok({ exePath, modelPath, voiceId });
}

const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"

/** True if the bytes begin with the RIFF/WAVE magic. */
export function isWav(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return RIFF.every((b, i) => bytes[i] === b);
}

/** Synthesize `text` to WAV bytes via the installed Piper (validates the output). */
export async function synthesize(
  text: string,
  install: PiperInstall,
  run: RunPiper,
): Promise<Result<Uint8Array, DomainError>> {
  const trimmed = text.trim();
  if (trimmed === "") {
    return err(domainError("piper.empty-text", "Refusing to synthesize empty text"));
  }
  const result = await run(install.exePath, install.modelPath, trimmed);
  if (!result.ok) return err(result.error);
  if (!isWav(result.value)) {
    return err(domainError("piper.bad-output", "Piper did not produce a WAV"));
  }
  return ok(result.value);
}

/** The subset of a spawned child the adapter uses (injectable for testing). */
export interface ChildProcessLike {
  readonly stdin: { write(data: string): void; end(): void };
  readonly stderr: { on(event: "data", listener: (chunk: Buffer) => void): void };
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
}

export type SpawnPiper = (command: string, args: readonly string[]) => ChildProcessLike;

const defaultSpawn: SpawnPiper = (command, args) => {
  const child = spawn(command, [...args], { windowsHide: true });
  // Swallow a stdin EPIPE (child died mid-write) — an unhandled stream 'error' would
  // crash the process; the child 'error'/'close' handlers drive the actual result.
  child.stdin.on("error", () => undefined);
  return child;
};

/**
 * The real child-process adapter: spawns piper writing a WAV to a private temp file
 * (piper writes WAV to a file, not stdout), reads it back, and cleans up. CPU only —
 * no GPU flags. Used by the desktop main; `spawnFn` is injected so the orchestration
 * (temp dir, stdin, exit/read/cleanup, error paths) is unit-testable with a test double.
 */
export function createNodeRunPiper(spawnFn: SpawnPiper = defaultSpawn): RunPiper {
  return (exePath, modelPath, text) =>
    new Promise<Result<Uint8Array, DomainError>>((resolve) => {
      let outDir: string;
      try {
        outDir = mkdtempSync(join(tmpdir(), "lodestar-tts-"));
      } catch (e) {
        resolve(err(domainError("piper.tmp-failed", String(e))));
        return;
      }
      const outFile = join(outDir, "out.wav");
      const cleanup = (): void => {
        rmSync(outDir, { recursive: true, force: true });
      };
      const child = spawnFn(exePath, ["--model", modelPath, "--output_file", outFile]);
      let stderr = "";
      child.stderr.on("data", (d) => {
        stderr += d.toString("utf8");
      });
      child.on("error", (e) => {
        cleanup();
        resolve(err(domainError("piper.spawn-failed", String(e))));
      });
      child.on("close", (code) => {
        if (code !== 0) {
          cleanup();
          resolve(
            err(domainError("piper.exit", `piper exited ${String(code)}: ${stderr.slice(0, 200)}`)),
          );
          return;
        }
        try {
          const wav = new Uint8Array(readFileSync(outFile));
          cleanup();
          resolve(ok(wav));
        } catch (e) {
          cleanup();
          resolve(err(domainError("piper.read-failed", String(e))));
        }
      });
      child.stdin.write(`${text}\n`);
      child.stdin.end();
    });
}
