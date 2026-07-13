/**
 * Typed settings service over the `settings` table (SSOT §Step 0.7). Each key
 * has a validator and a default; values are stored as JSON. Invalid writes
 * return Result.err and are not persisted. Corrupt/unparseable stored values
 * read back as the safe default (never a crash). Consent flags default OFF and
 * their single canonical write surface is the Privacy panel (Step 10.5) — the
 * service permits writes, the UI enforces read-only until then.
 */

import { isLoopbackUrl } from "@lodestar/shared";
import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";
import type { Db } from "@lodestar/data";

export interface SettingsSchema {
  readonly journalPath: string | null;
  readonly ollamaEndpoint: string;
  readonly aiGpuUuid: string | null;
  readonly consentWing: boolean;
  readonly consentCommunity: boolean;
  readonly consentDiscord: boolean;
  /** Piper TTS verdict callouts (Step 2.7b). Off by default (opt-in first-run download). */
  readonly ttsEnabled: boolean;
  /** Canonical Piper voice id (validity is enforced at install time, not here). */
  readonly ttsVoice: string;
  /** Playback volume 0–1. */
  readonly ttsVolume: number;
}

export type SettingsKey = keyof SettingsSchema;

export const DEFAULT_SETTINGS: SettingsSchema = {
  journalPath: null,
  ollamaEndpoint: "http://127.0.0.1:11434",
  aiGpuUuid: null,
  consentWing: false,
  consentCommunity: false,
  consentDiscord: false,
  ttsEnabled: false,
  ttsVoice: "en_US-ryan-high",
  ttsVolume: 0.8,
};

type Validator<K extends SettingsKey> = (value: unknown) => value is SettingsSchema[K];

const isNullableString = (v: unknown): v is string | null => v === null || typeof v === "string";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";

const isLoopbackEndpoint = (v: unknown): v is string => typeof v === "string" && isLoopbackUrl(v);

/** A non-empty, bounded voice id; the pinned-voice check lives in the Piper installer. */
const isVoiceId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 64;
const isVolume = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * A local absolute journal path or null. UNC/network paths (`\\host\share`) are
 * refused — the locator/probe stat()s this path, and stat'ing a UNC path on
 * Windows triggers an outbound SMB/NTLM auth attempt (credential-leak vector).
 */
const isLocalJournalPath = (v: unknown): v is string | null => {
  if (v === null) return true;
  if (typeof v !== "string") return false;
  if (v.startsWith("\\\\") || v.startsWith("//")) return false;
  return /^[a-zA-Z]:[\\/]/.test(v) || v.startsWith("/");
};

const VALIDATORS: { [K in SettingsKey]: Validator<K> } = {
  journalPath: isLocalJournalPath,
  ollamaEndpoint: isLoopbackEndpoint,
  aiGpuUuid: isNullableString,
  consentWing: isBoolean,
  consentCommunity: isBoolean,
  consentDiscord: isBoolean,
  ttsEnabled: isBoolean,
  ttsVoice: isVoiceId,
  ttsVolume: isVolume,
};

export interface SettingsService {
  get: <K extends SettingsKey>(key: K) => Result<SettingsSchema[K], DomainError>;
  set: <K extends SettingsKey>(key: K, value: SettingsSchema[K]) => Result<void, DomainError>;
}

export function createSettingsService(db: Db): SettingsService {
  const selectStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
  const upsertStmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );

  return {
    get<K extends SettingsKey>(key: K): Result<SettingsSchema[K], DomainError> {
      const row = selectStmt.get(key) as { value: string } | undefined;
      if (row === undefined) return ok(DEFAULT_SETTINGS[key]);
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.value);
      } catch {
        // Corrupt stored value — fall back to the safe default, never crash.
        return ok(DEFAULT_SETTINGS[key]);
      }
      if (!VALIDATORS[key](parsed)) return ok(DEFAULT_SETTINGS[key]);
      return ok(parsed);
    },

    set<K extends SettingsKey>(key: K, value: SettingsSchema[K]): Result<void, DomainError> {
      if (!VALIDATORS[key](value)) {
        return err(domainError("settings.invalid-value", `Invalid value for setting "${key}"`));
      }
      upsertStmt.run(key, JSON.stringify(value));
      return ok(undefined);
    },
  };
}
