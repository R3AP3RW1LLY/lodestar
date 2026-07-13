import { useCallback, useEffect, useState } from "react";
import type { SecretsPresence, SettingsSnapshot } from "@lodestar/shared";
import { MfdPanel } from "../components/MfdPanel.js";
import { MfdButton } from "../components/MfdButton.js";

type SecretKey = keyof SecretsPresence;

const SECRET_FIELDS: readonly { key: SecretKey; label: string }[] = [
  { key: "inaraApiKey", label: "Inara API Key" },
  { key: "capiTokens", label: "Frontier cAPI Tokens" },
  { key: "discordWebhookUrl", label: "Discord Webhook URL" },
];

const CONSENT_FIELDS: readonly { key: keyof SettingsSnapshot; label: string }[] = [
  { key: "consentWing", label: "Wing sharing" },
  { key: "consentCommunity", label: "Community contributions" },
  { key: "consentDiscord", label: "Discord debriefs" },
];

/**
 * Settings screen (SSOT Step 0.8). Edits journal path (auto-detect + live
 * validation), Ollama endpoint (loopback-validated in main), AI GPU selection,
 * and API keys (masked, stored via safeStorage — values never read back).
 * Consent toggles are READ-ONLY here; the Privacy panel (Step 10.5) is their
 * sole write surface.
 */
export function Settings(): React.JSX.Element {
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);
  const [presence, setPresence] = useState<SecretsPresence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setSettings(await window.lodestar.getSettings());
        setPresence(await window.lodestar.getSecretsPresence());
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, []);

  const update = useCallback(
    <K extends keyof SettingsSnapshot>(key: K, value: SettingsSnapshot[K]) => {
      setSettings((prev) => (prev === null ? prev : { ...prev, [key]: value }));
    },
    [],
  );

  const save = useCallback(
    async (key: keyof SettingsSnapshot, value: string | boolean | null): Promise<boolean> => {
      setError(null);
      setSavedNote(null);
      try {
        const fresh = await window.lodestar.setSetting({ key, value });
        // Merge only the saved key so other in-progress edits are not clobbered.
        setSettings((prev) => (prev === null ? fresh : { ...prev, [key]: fresh[key] }));
        setSavedNote(`${key} saved`);
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    },
    [],
  );

  const saveJournal = useCallback(async () => {
    if (settings === null) return;
    if (!(await save("journalPath", settings.journalPath))) return;
    // Surface CONTENT validation: the path may be syntactically valid but hold
    // no Journal.*.log files. journalStatus reflects validateJournalDir.
    try {
      const health = await window.lodestar.getHealth();
      if (settings.journalPath !== null && health.journalStatus === "error") {
        setError("Saved, but no Journal.*.log files were found at that path.");
      }
    } catch {
      // health probe failure is non-fatal for the save itself
    }
  }, [save, settings]);

  if (settings === null) {
    // A failed initial load must be visible — never a permanent silent spinner.
    return (
      <div className="p-4">
        {error !== null && (
          <p role="alert" className="text-signal-danger">
            {error}
          </p>
        )}
        <p>loading settings…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="settings-screen">
      <h1 className="font-display text-lg uppercase tracking-[0.3em] text-orange">Settings</h1>
      {error !== null && (
        <p role="alert" className="text-signal-danger">
          {error}
        </p>
      )}
      {savedNote !== null && <p className="text-signal-ok">{savedNote}</p>}

      <MfdPanel title="Journal">
        <label className="flex flex-col gap-1">
          <span className="text-cyan">Journal path</span>
          <input
            className="bg-void-900 p-1 text-orange"
            value={settings.journalPath ?? ""}
            onChange={(e) => {
              update("journalPath", e.target.value === "" ? null : e.target.value);
            }}
          />
        </label>
        <div className="mt-2 flex gap-2">
          <MfdButton
            onClick={() => {
              void saveJournal();
            }}
          >
            Save Journal
          </MfdButton>
          <MfdButton
            variant="ghost"
            onClick={() => {
              void (async () => {
                const { path } = await window.lodestar.autodetectJournal();
                if (path !== null) {
                  update("journalPath", path);
                  setSavedNote("journal path auto-detected");
                }
              })();
            }}
          >
            Auto-detect
          </MfdButton>
        </div>
      </MfdPanel>

      <MfdPanel title="Local AI">
        <label className="flex flex-col gap-1">
          <span className="text-cyan">Ollama endpoint</span>
          <input
            className="bg-void-900 p-1 text-orange"
            value={settings.ollamaEndpoint}
            onChange={(e) => {
              update("ollamaEndpoint", e.target.value);
            }}
          />
        </label>
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-cyan">AI GPU UUID</span>
          <input
            className="bg-void-900 p-1 text-orange"
            value={settings.aiGpuUuid ?? ""}
            onChange={(e) => {
              update("aiGpuUuid", e.target.value === "" ? null : e.target.value);
            }}
          />
        </label>
        <div className="mt-2 flex gap-2">
          <MfdButton
            onClick={() => {
              void save("ollamaEndpoint", settings.ollamaEndpoint);
            }}
          >
            Save Ollama
          </MfdButton>
          <MfdButton
            onClick={() => {
              void save("aiGpuUuid", settings.aiGpuUuid);
            }}
          >
            Save AI GPU
          </MfdButton>
          <MfdButton
            variant="ghost"
            onClick={() => {
              void (async () => {
                const gpus = await window.lodestar.listGpus();
                const first = gpus[0];
                if (first !== undefined) await save("aiGpuUuid", first.uuid);
              })();
            }}
          >
            Detect GPUs
          </MfdButton>
        </div>
      </MfdPanel>

      <MfdPanel title="Secrets">
        {SECRET_FIELDS.map((field) => (
          <SecretField
            key={field.key}
            fieldKey={field.key}
            label={field.label}
            isSet={presence?.[field.key] ?? false}
            onSaved={setPresence}
            onError={setError}
          />
        ))}
      </MfdPanel>

      <MfdPanel title="Privacy & Consent">
        <p className="mb-2 text-xs text-cyan-dim">
          These are read-only here — the Privacy panel (arrives in Phase 10) is their only control.
          All default OFF.
        </p>
        {CONSENT_FIELDS.map((field) => (
          <label key={field.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled
              checked={settings[field.key] === true}
              readOnly
              aria-label={field.label}
            />
            <span className="text-orange">{field.label}</span>
          </label>
        ))}
      </MfdPanel>
    </div>
  );
}

interface SecretFieldProps {
  readonly fieldKey: SecretKey;
  readonly label: string;
  readonly isSet: boolean;
  readonly onSaved: (presence: SecretsPresence) => void;
  readonly onError: (message: string) => void;
}

function SecretField({
  fieldKey,
  label,
  isSet,
  onSaved,
  onError,
}: SecretFieldProps): React.JSX.Element {
  const [value, setValue] = useState("");
  return (
    <div className="mb-2">
      <label className="flex flex-col gap-1">
        <span className="text-cyan">{label}</span>
        <input
          type="password"
          className="bg-void-900 p-1 text-orange"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
      </label>
      <div className="mt-1 flex items-center gap-2">
        <MfdButton
          onClick={() => {
            void (async () => {
              try {
                const p = await window.lodestar.setSecret({ key: fieldKey, value });
                setValue(""); // clear the plaintext from the field on success
                onSaved(p);
              } catch (cause) {
                onError(cause instanceof Error ? cause.message : String(cause));
              }
            })();
          }}
        >
          Save {label.split(" ")[0]}
        </MfdButton>
        <MfdButton
          variant="ghost"
          onClick={() => {
            void (async () => {
              try {
                const p = await window.lodestar.setSecret({ key: fieldKey, value: null });
                setValue("");
                onSaved(p);
              } catch (cause) {
                onError(cause instanceof Error ? cause.message : String(cause));
              }
            })();
          }}
        >
          Clear
        </MfdButton>
        <span data-testid={`${fieldKey}-presence`} className="text-xs text-cyan-dim">
          {isSet ? "SET" : "not set"}
        </span>
      </div>
    </div>
  );
}
