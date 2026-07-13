/**
 * TTS service (SSOT Step 2.7b-ii). The main-process glue that turns Assay verdicts
 * (and the Settings test-phrase button) into audible speech: it lazily ensures the
 * pinned Piper binary + voice are installed (hash-verified download via the
 * integrations downloader), synthesizes the callout WAV, and pushes it to the
 * renderer to play. All I/O (download / run / fs) is injected so the flow is
 * unit-testable without the real binary or network. CPU only — no GPU.
 */

import { Buffer } from "node:buffer";
import { downloadArtifact, nodeFetch } from "@lodestar/integrations";
import {
  createNodePiperFs,
  createNodeRunPiper,
  ensureInstalled,
  formatCallout,
  synthesize,
} from "@lodestar/voice";
import type { ArtifactFetcher, PiperFs, PiperInstall, RunPiper } from "@lodestar/voice";
import type { AssayVerdict } from "@lodestar/core";
import type { Logger, TtsAudio, TtsTestResult } from "@lodestar/shared";

export interface TtsSettings {
  readonly enabled: boolean;
  readonly voice: string;
  readonly volume: number;
}

export interface TtsServiceDeps {
  /** Install root for piper.exe + voices (e.g. `<dataDir>/voices`). */
  readonly dir: string;
  /** The current TTS settings, read fresh per callout (live toggle/volume). */
  readonly settings: () => TtsSettings;
  /** Push a synthesized callout WAV to the renderer for playback. */
  readonly emitAudio: (audio: TtsAudio) => void;
  readonly logger: Logger;
  /** Injected for tests; defaults to the real hash-verified downloader + Piper. */
  readonly download?: ArtifactFetcher;
  readonly run?: RunPiper;
  readonly fs?: PiperFs;
}

export interface TtsService {
  /** Speak a verdict callout if TTS is enabled (fire-and-forget). */
  onVerdict: (verdict: AssayVerdict) => void;
  /** Synthesize + push a test phrase regardless of the enabled flag (Settings button). */
  test: () => Promise<TtsTestResult>;
}

const TEST_PHRASE = "Lodestar voice online. Platinum, thirty-two percent. Mine.";
type SpeakOutcome = { readonly ok: true } | { readonly ok: false; readonly error: string };

export function createTtsService(deps: TtsServiceDeps): TtsService {
  const download: ArtifactFetcher =
    deps.download ??
    ((artifact) =>
      downloadArtifact({
        url: artifact.url,
        sha256: artifact.sha256,
        fetchFn: nodeFetch,
        maxBytes: artifact.bytes + 1_048_576,
      }));
  const run: RunPiper = deps.run ?? createNodeRunPiper();
  const fs: PiperFs = deps.fs ?? createNodePiperFs();

  let install: PiperInstall | undefined;
  // The install collapse is keyed only by the single global voice today; when a
  // voice PICKER lands, `installing` must be keyed by voiceId (a concurrent request
  // for a different voice would otherwise receive the wrong install).
  let installing: Promise<PiperInstall | undefined> | undefined;
  // Bound repeated re-downloads on a PERSISTENT install fault (e.g. a bad pin
  // hash-mismatching after streaming ~130 MB) — after this many consecutive
  // failures we stop trying until the app restarts, rather than a bandwidth sink.
  const MAX_INSTALL_FAILURES = 3;
  let installFailures = 0;

  async function ensure(voiceId: string): Promise<PiperInstall | undefined> {
    if (install !== undefined && install.voiceId === voiceId) return install;
    if (installFailures >= MAX_INSTALL_FAILURES) return undefined;
    // Collapse concurrent first-run installs onto one download; NEVER rejects
    // (a thrown fs/network error resolves to undefined so callers can't leak an
    // unhandled rejection).
    installing ??= (async () => {
      try {
        const r = await ensureInstalled({ dir: deps.dir, voiceId, download, fs });
        if (!r.ok) {
          installFailures += 1;
          deps.logger.error("tts.install-failed", { error: r.error.code });
          return undefined;
        }
        installFailures = 0;
        install = r.value;
        return r.value;
      } catch (error) {
        installFailures += 1;
        deps.logger.error("tts.install-threw", { error: String(error) });
        return undefined;
      }
    })();
    try {
      return await installing;
    } finally {
      installing = undefined;
    }
  }

  async function speak(text: string, s: TtsSettings): Promise<SpeakOutcome> {
    if (text === "") return { ok: false, error: "empty-callout" };
    const inst = await ensure(s.voice);
    if (inst === undefined) return { ok: false, error: "not-installed" };
    const wav = await synthesize(text, inst, run);
    if (!wav.ok) return { ok: false, error: wav.error.code };
    deps.emitAudio({ wavBase64: Buffer.from(wav.value).toString("base64"), volume: s.volume });
    return { ok: true };
  }

  return {
    onVerdict: (verdict) => {
      const s = deps.settings();
      // Speak only the actionable MINE callouts — SKIPs are the common case and
      // narrating every skipped rock would be noise.
      if (!s.enabled || verdict.call !== "MINE") return;
      void speak(formatCallout(verdict), s)
        .then((outcome) => {
          if (!outcome.ok) deps.logger.warn("tts.callout-skipped", { reason: outcome.error });
        })
        .catch((error: unknown) => {
          // Defensive: `speak` shouldn't reject, but a callout must never bubble an
          // unhandled rejection into the main process.
          deps.logger.warn("tts.callout-failed", { error: String(error) });
        });
    },
    test: async () => {
      const s = deps.settings();
      const outcome = await speak(TEST_PHRASE, { ...s, enabled: true });
      return outcome.ok ? { ok: true, error: null } : { ok: false, error: outcome.error };
    },
  };
}
