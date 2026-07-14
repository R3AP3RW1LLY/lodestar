/**
 * IPC channel contracts (SSOT §5.6). The Channel union is CLOSED — it grows
 * only when a phase's step adds a channel here together with its payload type.
 * Phase 0 defines app.health + settings/secrets/system; Step 1.9 adds the live
 * telemetry push channels state.snapshot / state.delta / session.stats.
 *
 * CHANNEL_SET is validated in BOTH directions at compile time: a payload type
 * without a CHANNEL_SET entry and a CHANNEL_SET entry without a payload type
 * are each compile errors.
 */

import type { RootState } from "./state.js";
import type { StateDelta } from "./state-delta.js";
import type { SessionSummary } from "./session.js";
import type { AssayVerdictEvent } from "./assay.js";

export interface AppHealth {
  readonly version: string;
  readonly dbStatus: "not-configured" | "ok" | "error";
  readonly journalStatus: "not-configured" | "ok" | "error";
}

/** Non-secret settings exposed to the renderer (secrets never cross as values). */
export interface SettingsSnapshot {
  readonly journalPath: string | null;
  readonly ollamaEndpoint: string;
  readonly aiGpuUuid: string | null;
  readonly consentWing: boolean;
  readonly consentCommunity: boolean;
  readonly consentDiscord: boolean;
  readonly ttsEnabled: boolean;
  readonly ttsVoice: string;
  readonly ttsVolume: number;
}

export interface SettingsSetRequest {
  readonly key: keyof SettingsSnapshot;
  readonly value: string | number | boolean | null;
}

/** A synthesized callout pushed to the renderer for playback (Step 2.7b). */
export interface TtsAudio {
  /** Base64-encoded WAV bytes (Piper output). */
  readonly wavBase64: string;
  /** Playback volume 0–1 (the current tts setting at synthesis time). */
  readonly volume: number;
}

/** Result of the Settings test-phrase button (main synthesizes + pushes audio). */
export interface TtsTestResult {
  readonly ok: boolean;
  readonly error: string | null;
}

/** A selectable TTS voice for the Settings picker (id + human label). */
export interface TtsVoiceOption {
  readonly id: string;
  readonly displayName: string;
}

/** Result of toggling the in-game overlay window (Step 2.10) — its new visibility. */
export interface OverlayToggleResult {
  readonly visible: boolean;
}

/** Presence-only view of secrets — booleans, never the secret values. */
export interface SecretsPresence {
  readonly inaraApiKey: boolean;
  readonly capiTokens: boolean;
  readonly discordWebhookUrl: boolean;
}

/** Secret write request — the value flows renderer→main only, never back. */
export interface SecretsSetRequest {
  readonly key: keyof SecretsPresence;
  /** null clears the secret. */
  readonly value: string | null;
}

export interface GpuInfo {
  readonly index: number;
  readonly uuid: string;
  readonly name: string;
  readonly memoryTotalMiB: number;
}

export interface ChannelPayloads {
  readonly "app.health": AppHealth;
  readonly "settings.get": SettingsSnapshot;
  readonly "settings.set": SettingsSnapshot;
  readonly "journal.autodetect": { readonly path: string | null };
  readonly "secrets.presence": SecretsPresence;
  readonly "secrets.set": SecretsPresence;
  readonly "system.gpus": readonly GpuInfo[];
  // Step 1.9 — live telemetry. `state.snapshot` is the full state (invoke, on
  // subscribe); `state.delta` + `session.stats` are push-only (main→renderer).
  readonly "state.snapshot": RootState;
  readonly "state.delta": StateDelta;
  readonly "session.stats": SessionSummary | null;
  // Step 2.7b — TTS. `tts.test` is a renderer→main invoke (synthesize + push a test
  // phrase); `tts.audio` is push-only (main→renderer) carrying a callout WAV.
  readonly "tts.test": TtsTestResult;
  readonly "tts.audio": TtsAudio;
  readonly "tts.voices": readonly TtsVoiceOption[];
  // Step 2.9 — Assay verdicts pushed to the renderer (main→renderer) for the dashboard.
  readonly "assay.verdict": AssayVerdictEvent;
  // Step 2.10 — Command Deck asks main to toggle the in-game overlay (invoke); the
  // reply carries the overlay's new visibility.
  readonly "overlay.toggle": OverlayToggleResult;
}

const CHANNEL_SET = {
  "app.health": true,
  "settings.get": true,
  "settings.set": true,
  "journal.autodetect": true,
  "secrets.presence": true,
  "secrets.set": true,
  "system.gpus": true,
  "state.snapshot": true,
  "state.delta": true,
  "session.stats": true,
  "tts.test": true,
  "tts.audio": true,
  "tts.voices": true,
  "assay.verdict": true,
  "overlay.toggle": true,
} as const satisfies Record<keyof ChannelPayloads, true>;

export type Channel = keyof ChannelPayloads;

export const CHANNELS = Object.keys(CHANNEL_SET) as readonly Channel[];

/**
 * Envelope is a distributive discriminated union: narrowing on `.channel`
 * narrows `.payload` for every consumer, not just the constructor call site.
 */
export type Envelope<C extends Channel = Channel> = {
  [K in Channel]: {
    readonly v: 1;
    readonly ts: string;
    readonly channel: K;
    readonly payload: ChannelPayloads[K];
  };
}[C];

/**
 * What isEnvelope actually verifies: outer shape only. The payload is
 * UNVALIDATED (`unknown`) — per-channel payload validation happens at each
 * channel's consumer (added with the channel's owning step).
 */
export interface EnvelopeShape {
  readonly v: 1;
  readonly ts: string;
  readonly channel: Channel;
  readonly payload: unknown;
}

export function envelope<C extends Channel>(
  channel: C,
  payload: ChannelPayloads[C],
  now: () => Date = () => new Date(),
): Envelope<C> {
  // The distributive union collapses to `never` for a generic C, so the plain
  // object literal needs an assertion; the wire shape it produces is exact.
  return { v: 1, ts: now().toISOString(), channel, payload } as Envelope<C>;
}

export function isEnvelope(value: unknown): value is EnvelopeShape {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record["v"] === 1 &&
    typeof record["ts"] === "string" &&
    typeof record["channel"] === "string" &&
    (CHANNELS as readonly string[]).includes(record["channel"]) &&
    Object.hasOwn(record, "payload")
  );
}
