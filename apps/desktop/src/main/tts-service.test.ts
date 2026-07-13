import { Buffer } from "node:buffer";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { domainError, err, nullLogger, ok } from "@lodestar/shared";
import type { TtsAudio } from "@lodestar/shared";
import { DEFAULT_VOICE_ID } from "@lodestar/voice";
import type { ArtifactFetcher, PiperFs, RunPiper } from "@lodestar/voice";
import type { AssayVerdict } from "@lodestar/core";
import { createTtsService } from "./tts-service.js";
import type { TtsSettings } from "./tts-service.js";

const WAV = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
const DIR = "C:/data/voices";
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** An fs whose markers say the install is already complete (no download needed). */
function installedFs(present: boolean): PiperFs {
  const files = new Set<string>();
  if (present) {
    files.add(join(DIR, "piper", ".installed"));
    files.add(join(DIR, `${DEFAULT_VOICE_ID}.installed`));
  }
  return {
    exists: (p) => files.has(p),
    writeFile: (p) => files.add(p),
  };
}

const MINE: AssayVerdict = {
  prospectId: 1,
  sessionId: 1,
  call: "MINE",
  score: 0,
  method: "laser",
  timestamp: "2025-06-01T12:00:00Z",
  reasons: [
    {
      code: "proportion-above-threshold",
      commodityId: "platinum",
      display: "Platinum",
      proportion: 32,
      threshold: 25,
    },
  ],
};
const SKIP: AssayVerdict = {
  ...MINE,
  call: "SKIP",
  reasons: [{ code: "already-depleted", remainingPct: 0 }],
};

const okRun: RunPiper = () => Promise.resolve(ok(WAV));
const noDownload: ArtifactFetcher = () =>
  Promise.reject(new Error("must not download when installed"));

function make(
  settings: TtsSettings,
  over: { run?: RunPiper; download?: ArtifactFetcher; fs?: PiperFs } = {},
) {
  const audio: TtsAudio[] = [];
  const svc = createTtsService({
    dir: DIR,
    settings: () => settings,
    emitAudio: (a) => audio.push(a),
    logger: nullLogger,
    run: over.run ?? okRun,
    download: over.download ?? noDownload,
    fs: over.fs ?? installedFs(true),
  });
  return { svc, audio };
}

describe("tts-service", () => {
  it("speaks a MINE callout when enabled — pushes the base64 WAV + volume", async () => {
    const { svc, audio } = make({ enabled: true, voice: DEFAULT_VOICE_ID, volume: 0.7 });
    svc.onVerdict(MINE);
    await flush();
    expect(audio).toHaveLength(1);
    expect(audio[0]?.volume).toBe(0.7);
    expect(Buffer.from(audio[0]?.wavBase64 ?? "", "base64")).toEqual(Buffer.from(WAV));
  });

  it("stays silent when TTS is disabled", async () => {
    const { svc, audio } = make({ enabled: false, voice: DEFAULT_VOICE_ID, volume: 0.7 });
    svc.onVerdict(MINE);
    await flush();
    expect(audio).toHaveLength(0);
  });

  it("does not narrate SKIP verdicts (only actionable MINE callouts)", async () => {
    const { svc, audio } = make({ enabled: true, voice: DEFAULT_VOICE_ID, volume: 0.5 });
    svc.onVerdict(SKIP);
    await flush();
    expect(audio).toHaveLength(0);
  });

  it("test() synthesizes + pushes a phrase even when disabled, returning ok", async () => {
    const { svc, audio } = make({ enabled: false, voice: DEFAULT_VOICE_ID, volume: 0.9 });
    const r = await svc.test();
    expect(r).toEqual({ ok: true, error: null });
    expect(audio).toHaveLength(1);
    expect(audio[0]?.volume).toBe(0.9);
  });

  it("test() reports a failure when the install cannot be obtained", async () => {
    const failing: ArtifactFetcher = () =>
      Promise.resolve(err(domainError("downloader.hash-mismatch", "bad")));
    const { svc, audio } = make(
      { enabled: true, voice: DEFAULT_VOICE_ID, volume: 0.5 },
      { fs: installedFs(false), download: failing },
    );
    const r = await svc.test();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("not-installed");
    expect(audio).toHaveLength(0);
  });

  it("warns (never throws) when a MINE callout cannot be synthesized", async () => {
    const warnings: string[] = [];
    const logger = { ...nullLogger, warn: (msg: string) => warnings.push(msg) };
    const failing: ArtifactFetcher = () =>
      Promise.resolve(err(domainError("downloader.hash-mismatch", "x")));
    const audio: TtsAudio[] = [];
    const svc = createTtsService({
      dir: DIR,
      settings: () => ({ enabled: true, voice: DEFAULT_VOICE_ID, volume: 0.5 }),
      emitAudio: (a) => audio.push(a),
      logger,
      download: failing,
      run: okRun,
      fs: installedFs(false),
    });
    svc.onVerdict(MINE);
    await flush();
    expect(audio).toHaveLength(0);
    expect(warnings).toContain("tts.callout-skipped");
  });

  it("surfaces a synthesis failure as a failed test result", async () => {
    const badRun: RunPiper = () => Promise.resolve(err(domainError("piper.exit", "exited 1")));
    const { svc } = make({ enabled: true, voice: DEFAULT_VOICE_ID, volume: 0.5 }, { run: badRun });
    const r = await svc.test();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("piper.exit");
  });

  it("onVerdict never leaks an unhandled rejection when install THROWS (fs/network)", async () => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const logger = {
      ...nullLogger,
      error: (msg: string) => errors.push(msg),
      warn: (msg: string) => warnings.push(msg),
    };
    const throwing: ArtifactFetcher = () => Promise.reject(new Error("network boom"));
    const svc = createTtsService({
      dir: DIR,
      settings: () => ({ enabled: true, voice: DEFAULT_VOICE_ID, volume: 0.5 }),
      emitAudio: () => undefined,
      logger,
      download: throwing,
      run: okRun,
      fs: installedFs(false), // no markers → attempts install → download rejects
    });
    expect(() => {
      svc.onVerdict(MINE);
    }).not.toThrow();
    await flush();
    expect(errors).toContain("tts.install-threw");
    expect(warnings).toContain("tts.callout-skipped");
  });

  it("stops re-attempting a persistently-failing install (bandwidth guard)", async () => {
    let downloads = 0;
    const failing: ArtifactFetcher = () => {
      downloads += 1;
      return Promise.resolve(err(domainError("downloader.hash-mismatch", "x")));
    };
    const svc = createTtsService({
      dir: DIR,
      settings: () => ({ enabled: true, voice: DEFAULT_VOICE_ID, volume: 0.5 }),
      emitAudio: () => undefined,
      logger: nullLogger,
      download: failing,
      run: okRun,
      fs: installedFs(false),
    });
    for (let i = 0; i < 5; i += 1) await svc.test();
    expect(downloads).toBe(3); // capped at MAX_INSTALL_FAILURES, not 5
  });
});
