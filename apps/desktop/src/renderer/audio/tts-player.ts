/**
 * Renderer TTS playback (SSOT Step 2.7b-ii). Decodes the base64 WAV pushed from the
 * main process and plays it through the Web Audio API with a gain node for volume.
 * The AudioContext is injected (a factory) so the decode + gain + play sequence is
 * unit-testable under jsdom (which has no real Web Audio) with a cast stand-in.
 */

import type { TtsAudio } from "@lodestar/shared";

export interface TtsPlayer {
  play(audio: TtsAudio): Promise<void>;
  dispose(): void;
}

/** Decode base64 → bytes without Buffer (renderer has `atob`, not node globals). */
export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function createTtsPlayer(makeContext: () => AudioContext): TtsPlayer {
  let ctx: AudioContext | undefined;
  return {
    async play(audio) {
      ctx ??= makeContext();
      const bytes = base64ToBytes(audio.wavBase64);
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const decoded = await ctx.decodeAudioData(buffer);
      const source = ctx.createBufferSource();
      source.buffer = decoded;
      const gain = ctx.createGain();
      gain.gain.value = Math.max(0, Math.min(1, audio.volume)); // clamp 0–1
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start();
    },
    dispose() {
      void ctx?.close();
      ctx = undefined;
    },
  };
}
