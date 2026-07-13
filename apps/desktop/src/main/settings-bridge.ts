/**
 * Settings/secrets/journal bridge: the glue between the core services and the
 * IPC handlers, extracted from the app entry so it is unit-testable. Secret
 * VALUES never appear here (presence booleans only). Consent flags are
 * read-only through setSetting — rejected server-side, not just in the UI; the
 * Privacy panel (Step 10.5) owns consent writes.
 */

import { DEFAULT_SETTINGS, locateJournalDir, validateJournalDir } from "@lodestar/core";
import type { SecretsStore, SettingsService, SettingsKey, SecretKey } from "@lodestar/core";
import type {
  SecretsPresence,
  SecretsSetRequest,
  SettingsSetRequest,
  SettingsSnapshot,
  WireResult,
} from "@lodestar/shared";
import { domainError, err, ok, toWireResult } from "@lodestar/shared";

const SETTINGS_KEYS: readonly SettingsKey[] = [
  "journalPath",
  "ollamaEndpoint",
  "aiGpuUuid",
  "consentWing",
  "consentCommunity",
  "consentDiscord",
  "ttsEnabled",
  "ttsVoice",
  "ttsVolume",
];

const CONSENT_KEYS = new Set<SettingsKey>(["consentWing", "consentCommunity", "consentDiscord"]);

export interface SettingsBridgeDeps {
  readonly settings: SettingsService | undefined;
  readonly secrets: SecretsStore | undefined;
  readonly journalCandidates: () => readonly string[];
}

const SECRET_KEYS = new Set<SecretKey>(["inaraApiKey", "capiTokens", "discordWebhookUrl"]);

export interface SettingsBridge {
  getSettings: () => SettingsSnapshot;
  setSetting: (req: SettingsSetRequest) => WireResult<SettingsSnapshot>;
  autodetectJournal: () => { path: string | null };
  secretsPresence: () => SecretsPresence;
  setSecret: (req: SecretsSetRequest) => WireResult<SecretsPresence>;
  probeJournal: () => "not-configured" | "ok" | "error";
}

export function createSettingsBridge(deps: SettingsBridgeDeps): SettingsBridge {
  function snapshot(): SettingsSnapshot {
    const svc = deps.settings;
    if (svc === undefined) return { ...DEFAULT_SETTINGS };
    const read = <K extends SettingsKey>(key: K): SettingsSnapshot[K] => {
      const r = svc.get(key);
      return r.ok ? r.value : DEFAULT_SETTINGS[key];
    };
    return {
      journalPath: read("journalPath"),
      ollamaEndpoint: read("ollamaEndpoint"),
      aiGpuUuid: read("aiGpuUuid"),
      consentWing: read("consentWing"),
      consentCommunity: read("consentCommunity"),
      consentDiscord: read("consentDiscord"),
      ttsEnabled: read("ttsEnabled"),
      ttsVoice: read("ttsVoice"),
      ttsVolume: read("ttsVolume"),
    };
  }

  return {
    getSettings: snapshot,

    setSetting(req: SettingsSetRequest): WireResult<SettingsSnapshot> {
      const svc = deps.settings;
      if (svc === undefined) {
        return toWireResult(err(domainError("settings.unavailable", "settings not initialized")));
      }
      if (!SETTINGS_KEYS.includes(req.key)) {
        return toWireResult(err(domainError("settings.invalid-value", `unknown key "${req.key}"`)));
      }
      // Consent flags are read-only through this path — enforced server-side,
      // not just in the UI. The Privacy panel (Step 10.5) owns consent writes.
      if (CONSENT_KEYS.has(req.key)) {
        return toWireResult(
          err(
            domainError(
              "settings.consent-readonly",
              "consent flags are set only in the Privacy panel",
            ),
          ),
        );
      }
      const result = svc.set(req.key, req.value);
      if (!result.ok) return toWireResult(err(result.error));
      return toWireResult(ok(snapshot()));
    },

    autodetectJournal(): { path: string | null } {
      const found = locateJournalDir(deps.journalCandidates());
      if (found.ok) {
        deps.settings?.set("journalPath", found.value);
        return { path: found.value };
      }
      return { path: null };
    },

    secretsPresence(): SecretsPresence {
      const present = (key: SecretKey): boolean => {
        const r = deps.secrets?.get(key);
        return r?.ok === true && r.value !== null;
      };
      return {
        inaraApiKey: present("inaraApiKey"),
        capiTokens: present("capiTokens"),
        discordWebhookUrl: present("discordWebhookUrl"),
      };
    },

    setSecret(req: SecretsSetRequest): WireResult<SecretsPresence> {
      const store = deps.secrets;
      if (store === undefined) {
        return toWireResult(err(domainError("secrets.unavailable", "secrets not initialized")));
      }
      if (!SECRET_KEYS.has(req.key)) {
        return toWireResult(err(domainError("secrets.invalid-key", `unknown secret "${req.key}"`)));
      }
      if (req.value === null || req.value === "") {
        store.delete(req.key);
      } else {
        const result = store.set(req.key, req.value);
        if (!result.ok) return toWireResult(err(result.error));
      }
      // Return presence only — never echo the value back.
      const present = (key: SecretKey): boolean => {
        const r = store.get(key);
        return r.ok && r.value !== null;
      };
      return toWireResult(
        ok({
          inaraApiKey: present("inaraApiKey"),
          capiTokens: present("capiTokens"),
          discordWebhookUrl: present("discordWebhookUrl"),
        }),
      );
    },

    probeJournal(): "not-configured" | "ok" | "error" {
      const svc = deps.settings;
      if (svc === undefined) return "not-configured";
      const pathResult = svc.get("journalPath");
      if (!pathResult.ok || pathResult.value === null) return "not-configured";
      return validateJournalDir(pathResult.value).ok ? "ok" : "error";
    },
  };
}
