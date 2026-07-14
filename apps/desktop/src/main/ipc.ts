/**
 * IPC handler registration. Every invoke channel returns the §5.6 serialized
 * wire result so DomainError never crosses as a class instance. The renderer
 * only ever sees channels registered here. Secrets cross as presence booleans
 * only — never their values (SSOT §4.6).
 */

import type {
  AppHealth,
  Channel,
  GpuInfo,
  OverlayToggleResult,
  RootState,
  SecretsPresence,
  SecretsSetRequest,
  SettingsSetRequest,
  SettingsSnapshot,
  TtsTestResult,
  TtsVoiceOption,
  WireResult,
} from "@lodestar/shared";
import { domainError, err, ok, toWireResult } from "@lodestar/shared";

export interface IpcMainLike {
  handle: (channel: Channel, listener: (...args: unknown[]) => unknown) => void;
}

/** Electron's ipcMain: it invokes listeners as (invokeEvent, ...args). */
export interface ElectronIpcMain {
  handle: (channel: Channel, listener: (event: unknown, ...args: unknown[]) => unknown) => void;
}

/**
 * Adapts Electron's ipcMain to the payload-only IpcMainLike the handlers expect.
 * Electron passes the IpcMainInvokeEvent as the first listener argument and the
 * renderer's request as the second; our handlers are pure functions of the
 * request, so the event is stripped here at the boundary. Without this, every
 * arg-taking channel would read the event object as its payload.
 */
export function electronIpcAdapter(ipcMain: ElectronIpcMain): IpcMainLike {
  return {
    handle: (channel, listener) => {
      ipcMain.handle(channel, (_event, ...args) => listener(...args));
    },
  };
}

export interface IpcDeps {
  readonly getHealth: () => AppHealth;
  readonly getSettings: () => SettingsSnapshot;
  readonly setSetting: (req: SettingsSetRequest) => WireResult<SettingsSnapshot>;
  readonly autodetectJournal: () => { path: string | null };
  readonly getSecretsPresence: () => SecretsPresence;
  readonly setSecret: (req: SecretsSetRequest) => WireResult<SecretsPresence>;
  readonly listGpus: () => Promise<readonly GpuInfo[]>;
  /** Renderer subscribed: returns the current full state and re-baselines the delta stream. */
  readonly subscribeState: () => RootState;
  /** Settings test-phrase button: synthesize + push a callout, report success. */
  readonly testTts: () => Promise<TtsTestResult>;
  /** The pinned TTS voice options for the Settings picker. */
  readonly listVoices: () => readonly TtsVoiceOption[];
  /** Command Deck overlay toggle: show/hide the in-game overlay, report new visibility. */
  readonly toggleOverlay: () => OverlayToggleResult;
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcDeps): void {
  ipcMain.handle("app.health", (): WireResult<AppHealth> => toWireResult(ok(deps.getHealth())));

  ipcMain.handle("settings.get", (): WireResult<SettingsSnapshot> =>
    toWireResult(ok(deps.getSettings())),
  );

  ipcMain.handle("settings.set", (raw: unknown): WireResult<SettingsSnapshot> => {
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof (raw as { key?: unknown }).key !== "string"
    ) {
      return toWireResult(err(domainError("ipc.bad-args", "settings.set requires { key, value }")));
    }
    return deps.setSetting(raw as SettingsSetRequest);
  });

  ipcMain.handle("journal.autodetect", (): WireResult<{ path: string | null }> =>
    toWireResult(ok(deps.autodetectJournal())),
  );

  ipcMain.handle("secrets.presence", (): WireResult<SecretsPresence> =>
    toWireResult(ok(deps.getSecretsPresence())),
  );

  ipcMain.handle("secrets.set", (raw: unknown): WireResult<SecretsPresence> => {
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof (raw as { key?: unknown }).key !== "string"
    ) {
      return toWireResult(err(domainError("ipc.bad-args", "secrets.set requires { key, value }")));
    }
    return deps.setSecret(raw as SecretsSetRequest);
  });

  ipcMain.handle("system.gpus", async (): Promise<WireResult<readonly GpuInfo[]>> =>
    toWireResult(ok(await deps.listGpus())),
  );

  ipcMain.handle("state.snapshot", (): WireResult<RootState> =>
    toWireResult(ok(deps.subscribeState())),
  );

  ipcMain.handle("tts.test", async (): Promise<WireResult<TtsTestResult>> =>
    toWireResult(ok(await deps.testTts())),
  );

  ipcMain.handle("tts.voices", (): WireResult<readonly TtsVoiceOption[]> =>
    toWireResult(ok(deps.listVoices())),
  );

  ipcMain.handle("overlay.toggle", (): WireResult<OverlayToggleResult> =>
    toWireResult(ok(deps.toggleOverlay())),
  );
}
