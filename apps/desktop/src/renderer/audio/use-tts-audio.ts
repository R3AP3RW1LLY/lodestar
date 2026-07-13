import { useEffect } from "react";
import { createTtsPlayer } from "./tts-player.js";

/**
 * Subscribe to verdict callouts pushed from main and play them (SSOT Step 2.7b).
 * The AudioContext is created lazily inside the player (on first play), so mounting
 * this hook is side-effect-free until audio actually arrives. A decode/playback
 * failure is swallowed — a bad WAV must never crash the UI.
 */
export function useTtsAudio(): void {
  useEffect(() => {
    const player = createTtsPlayer(() => new AudioContext());
    const unsubscribe = window.lodestar.onTtsAudio((audio) => {
      void player.play(audio).catch(() => undefined);
    });
    return () => {
      unsubscribe();
      player.dispose();
    };
  }, []);
}
