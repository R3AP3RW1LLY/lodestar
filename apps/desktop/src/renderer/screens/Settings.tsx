import { useCallback, useEffect, useState } from "react";
import type { SecretsPresence, SettingsSnapshot, TtsVoiceOption } from "@lodestar/shared";
import { MfdPanel } from "../components/MfdPanel.js";
import { MfdButton } from "../components/MfdButton.js";

type SecretKey = keyof SecretsPresence;

const SECRET_FIELDS: readonly {
  key: SecretKey;
  label: string;
  description: string;
}[] = [
  {
    key: "inaraApiKey",
    label: "Inara API Key",
    description:
      "Optional. Extra market & reference data from inara.cz. Get one under your Inara profile → API keys.",
  },
  {
    key: "capiTokens",
    label: "Frontier cAPI Tokens",
    description:
      "Not required. Frontier's account API needs developer approval + an OAuth login — Polaris runs fully without it (journal + EDDN cover mining). Mainly useful later for fleet carriers.",
  },
  {
    key: "discordWebhookUrl",
    label: "Discord Webhook URL",
    description: "Optional. Session debriefs to Discord — off by default, wired in Phase 10.",
  },
];

/**
 * The data sources that feed the intelligence engine. Keyless-first: only Inara uses a
 * key and Frontier cAPI is optional. Status is honest — `live` sources are streaming now;
 * the galaxy sources are built and keyless but their live wiring is still in progress.
 */
const DATA_SOURCES: readonly {
  name: string;
  status: string;
  live: boolean;
  detail: string;
}[] = [
  {
    name: "Journal",
    status: "Live",
    live: true,
    detail:
      "Your real-time game feed — commander, ship, cargo, prospected rocks, scans, and your docked station's market. No key.",
  },
  {
    name: "EDDN",
    status: "Keyless · wiring in progress",
    live: false,
    detail: "Galaxy-wide live market prices shared by the community. No key.",
  },
  {
    name: "EDSM",
    status: "Keyless · wiring in progress",
    live: false,
    detail: "System & body reference (coordinates, ring types). No key needed for reads.",
  },
  {
    name: "Spansh",
    status: "Keyless · wiring in progress",
    live: false,
    detail: "Multi-jump route plotting for the Cartographer. No key.",
  },
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
  const [ttsNote, setTtsNote] = useState<string | null>(null);
  const [voices, setVoices] = useState<readonly TtsVoiceOption[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        setSettings(await window.lodestar.getSettings());
        setPresence(await window.lodestar.getSecretsPresence());
        setVoices(await window.lodestar.listVoices());
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
    async (
      key: keyof SettingsSnapshot,
      value: string | number | boolean | null,
    ): Promise<boolean> => {
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

      <MfdPanel title="Voice (TTS)">
        <p className="mb-2 text-xs text-cyan-dim">
          CPU-only Piper callouts for mine verdicts. On first enable the pinned voice (~130&nbsp;MB)
          downloads to your data dir — hash-verified.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={settings.ttsEnabled}
            onChange={(e) => {
              void save("ttsEnabled", e.target.checked);
            }}
            aria-label="Enable voice callouts"
          />
          <span className="text-orange">Enable mine/skip callouts</span>
        </label>
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-cyan">Voice</span>
          <select
            className="bg-void-900 p-1 text-orange"
            value={settings.ttsVoice}
            aria-label="TTS voice"
            data-testid="tts-voice"
            onChange={(e) => {
              void save("ttsVoice", e.target.value);
            }}
          >
            {voices.length === 0 && <option value={settings.ttsVoice}>{settings.ttsVoice}</option>}
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-2 flex flex-col gap-1">
          <span className="text-cyan">Volume {String(Math.round(settings.ttsVolume * 100))}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.ttsVolume}
            onChange={(e) => {
              update("ttsVolume", Number(e.target.value)); // live visual only
            }}
            onPointerUp={(e) => {
              void save("ttsVolume", Number(e.currentTarget.value)); // persist on release
            }}
            onKeyUp={(e) => {
              void save("ttsVolume", Number(e.currentTarget.value)); // keyboard commit
            }}
            aria-label="TTS volume"
          />
        </label>
        <div className="mt-2 flex items-center gap-2">
          <MfdButton
            onClick={() => {
              void (async () => {
                setTtsNote("synthesizing…");
                try {
                  const r = await window.lodestar.testTts();
                  setTtsNote(
                    r.ok ? "voice test played" : `voice test failed: ${r.error ?? "unknown"}`,
                  );
                } catch (cause) {
                  setTtsNote(cause instanceof Error ? cause.message : String(cause));
                }
              })();
            }}
          >
            Test voice
          </MfdButton>
          {ttsNote !== null && (
            <span data-testid="tts-note" className="text-xs text-cyan-dim">
              {ttsNote}
            </span>
          )}
        </div>
      </MfdPanel>

      <MfdPanel title="Data sources">
        <p className="mb-2 text-xs text-cyan-dim">
          Polaris is keyless-first. Your journal is the live game feed; the galaxy sources below
          need no key. Only Inara uses a key, and Frontier cAPI is optional (both under API keys).
        </p>
        <ul className="flex flex-col gap-2">
          {DATA_SOURCES.map((s) => (
            <li key={s.name} className="flex flex-col">
              <span className="flex items-center gap-2">
                <span className="text-orange">{s.name}</span>
                <span
                  className={`text-[10px] uppercase tracking-widest ${
                    s.live ? "text-signal-ok" : "text-signal-skip"
                  }`}
                >
                  {s.status}
                </span>
              </span>
              <span className="text-xs text-cyan-dim">{s.detail}</span>
            </li>
          ))}
        </ul>
      </MfdPanel>

      <MfdPanel title="API keys">
        <p className="mb-2 text-xs text-cyan-dim">
          All optional — Polaris mines fine with none of these. Keys are masked, stored via
          safeStorage, and never read back.
        </p>
        {SECRET_FIELDS.map((field) => (
          <SecretField
            key={field.key}
            fieldKey={field.key}
            label={field.label}
            description={field.description}
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
  readonly description: string;
  readonly isSet: boolean;
  readonly onSaved: (presence: SecretsPresence) => void;
  readonly onError: (message: string) => void;
}

function SecretField({
  fieldKey,
  label,
  description,
  isSet,
  onSaved,
  onError,
}: SecretFieldProps): React.JSX.Element {
  const [value, setValue] = useState("");
  return (
    <div className="mb-3">
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
      <p className="mt-1 text-xs text-cyan-dim">{description}</p>
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
