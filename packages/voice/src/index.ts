export type {
  SpeechClass,
  Utterance,
  Speaker,
  SpeechQueue,
  SpeechQueueOptions,
} from "./tts/speech-queue.js";
export { createSpeechQueue, SPEECH_CLASS_ORDER } from "./tts/speech-queue.js";
export type { CalloutInput, CalloutReason } from "./tts/callout.js";
export { formatCallout } from "./tts/callout.js";
export type { PinnedArtifact, VoiceAsset } from "./tts/piper-assets.js";
export { PIPER_BINARY, PIPER_EXE_PATH, VOICES, DEFAULT_VOICE_ID } from "./tts/piper-assets.js";
export { unzip, untarGz } from "./tts/archive.js";
export type {
  ArtifactFetcher,
  PiperFs,
  RunPiper,
  PiperInstall,
  EnsureInstalledOptions,
  SpawnPiper,
  ChildProcessLike,
} from "./tts/piper.js";
export {
  ensureInstalled,
  synthesize,
  isWav,
  createNodeRunPiper,
  createNodePiperFs,
} from "./tts/piper.js";
