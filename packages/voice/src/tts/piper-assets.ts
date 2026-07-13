/**
 * Pinned Piper provenance (SSOT Step 2.7b — closes the Step 0.10 "committed
 * URL/hash manifest" note). Every artifact is a GitHub release asset (the
 * allowlisted `github.com`, which 302s to the allowlisted release CDN; the
 * downloader follows that with a per-hop re-check). The committed SHA-256 is the
 * integrity guarantee. HuggingFace's Xet CDN 403s on a plain GET, so BOTH the
 * binary and the voice come from GitHub releases. Hashes verified 2026-07-13 by
 * downloading each asset and confirming a real WAV synthesis.
 */

export interface PinnedArtifact {
  readonly url: string;
  /** Lowercase hex SHA-256 — the integrity pin. */
  readonly sha256: string;
  /** Expected size (bytes) — a fast cross-check + download cap hint. */
  readonly bytes: number;
}

export interface VoiceAsset {
  readonly id: string;
  readonly displayName: string;
  /** The `.tar.gz` bundling the model + its config. */
  readonly archive: PinnedArtifact;
  /** The `.onnx` model path inside the archive. */
  readonly modelFile: string;
  /** The `.onnx.json` config path inside the archive. */
  readonly configFile: string;
}

/** The Piper Windows binary (zip → `piper/piper.exe` + DLLs + espeak-ng-data). */
export const PIPER_BINARY: PinnedArtifact = {
  url: "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip",
  sha256: "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea",
  bytes: 22_477_236,
};

/** piper.exe's path inside the extracted binary zip. */
export const PIPER_EXE_PATH = "piper/piper.exe";

export const VOICES: Readonly<Record<string, VoiceAsset>> = {
  "en_US-ryan-high": {
    id: "en_US-ryan-high",
    displayName: "Ryan — US English (high)",
    archive: {
      url: "https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-ryan-high.tar.gz",
      sha256: "de346b054703a190782f49acb9b93c50678a884fede49cfd85429d204802d678",
      bytes: 105_624_557,
    },
    modelFile: "en-us-ryan-high.onnx",
    configFile: "en-us-ryan-high.onnx.json",
  },
  "en_US-libritts-high": {
    id: "en_US-libritts-high",
    displayName: "LibriTTS — US English (high, warmer)",
    archive: {
      url: "https://github.com/rhasspy/piper/releases/download/v0.0.2/voice-en-us-libritts-high.tar.gz",
      sha256: "328e3e9cb573a43a6c5e1aeca386e971232bdb1418a74d4674cf726c973a0ea8",
      bytes: 120_620_366,
    },
    modelFile: "en-us-libritts-high.onnx",
    configFile: "en-us-libritts-high.onnx.json",
  },
};

/** Voice options for the Settings picker (id + human label), from the pinned catalog. */
export const VOICE_CATALOG: readonly { readonly id: string; readonly displayName: string }[] =
  Object.values(VOICES).map((v) => ({ id: v.id, displayName: v.displayName }));

/** The default voice (Step 2.7b). Users switch via the Settings voice picker. */
export const DEFAULT_VOICE_ID = "en_US-ryan-high";
