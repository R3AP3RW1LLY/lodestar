/**
 * IPC handler registration. Every invoke channel returns the §5.6 serialized
 * wire result so DomainError never crosses as a class instance. The renderer
 * only ever sees channels registered here. Secrets cross as presence booleans
 * only — never their values (SSOT §4.6).
 */

import type {
  AlertRuleRequest,
  AnalyticsExportRequest,
  AnalyticsExportResult,
  AppHealth,
  Channel,
  GpuInfo,
  LedgerAlertRule,
  LedgerBoardEntry,
  LedgerStation,
  LedgerStationQuery,
  LedgerTrendPoint,
  LedgerTrendQuery,
  ManifestData,
  OverlayMode,
  OverlayToggleResult,
  RootState,
  SessionDetail,
  SessionFilter,
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
  /** Command Deck overlay lock toggle: lock (click-through) ⇄ unlock (arrange), report new mode. */
  readonly lockOverlay: () => OverlayMode;
  /** Manifest CSV export: build the dataset, show a save dialog, write the file. */
  readonly exportAnalytics: (req: AnalyticsExportRequest) => Promise<AnalyticsExportResult>;
  /** Manifest dashboards: the full analytics bundle for a filter. */
  readonly getManifest: (filter: SessionFilter) => ManifestData;
  /** Manifest drill-down: one session's detail (null if unknown). */
  readonly getSessionDetail: (sessionId: number) => SessionDetail | null;
  /** Ledger board: best sell station per commodity. */
  readonly ledgerBoard: () => readonly LedgerBoardEntry[];
  /** Ledger station ranking for one commodity (source + age per row). */
  readonly ledgerStations: (query: LedgerStationQuery) => readonly LedgerStation[];
  /** Ledger price trend series for one commodity. */
  readonly ledgerTrend: (query: LedgerTrendQuery) => readonly LedgerTrendPoint[];
  readonly listAlerts: () => readonly LedgerAlertRule[];
  readonly addAlert: (request: AlertRuleRequest) => readonly LedgerAlertRule[];
  readonly setAlertEnabled: (id: number, enabled: boolean) => readonly LedgerAlertRule[];
  readonly deleteAlert: (id: number) => readonly LedgerAlertRule[];
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

  ipcMain.handle("overlay.lock", (): WireResult<OverlayMode> =>
    toWireResult(ok(deps.lockOverlay())),
  );

  ipcMain.handle(
    "analytics.export",
    async (raw: unknown): Promise<WireResult<AnalyticsExportResult>> => {
      const kind = (raw as { kind?: unknown } | null)?.kind;
      if (kind !== "sessions" && kind !== "refinements" && kind !== "prospects") {
        return toWireResult(
          err(
            domainError(
              "ipc.bad-args",
              "analytics.export requires kind ∈ sessions|refinements|prospects",
            ),
          ),
        );
      }
      const bom = (raw as { bom?: unknown }).bom === true;
      return toWireResult(ok(await deps.exportAnalytics({ kind, bom })));
    },
  );

  ipcMain.handle("analytics.manifest", (raw: unknown): WireResult<ManifestData> => {
    const filter = (typeof raw === "object" && raw !== null ? raw : {}) as SessionFilter;
    return toWireResult(ok(deps.getManifest(filter)));
  });

  ipcMain.handle("analytics.sessionDetail", (raw: unknown): WireResult<SessionDetail | null> => {
    const sessionId = (raw as { sessionId?: unknown } | null)?.sessionId;
    if (typeof sessionId !== "number") {
      return toWireResult(
        err(domainError("ipc.bad-args", "analytics.sessionDetail requires { sessionId }")),
      );
    }
    return toWireResult(ok(deps.getSessionDetail(sessionId)));
  });

  ipcMain.handle("ledger.board", (): WireResult<readonly LedgerBoardEntry[]> =>
    toWireResult(ok(deps.ledgerBoard())),
  );

  ipcMain.handle("ledger.stations", (raw: unknown): WireResult<readonly LedgerStation[]> => {
    const commodityId = (raw as { commodityId?: unknown } | null)?.commodityId;
    if (typeof commodityId !== "string") {
      return toWireResult(
        err(domainError("ipc.bad-args", "ledger.stations requires { commodityId }")),
      );
    }
    return toWireResult(ok(deps.ledgerStations(raw as LedgerStationQuery)));
  });

  ipcMain.handle("ledger.trend", (raw: unknown): WireResult<readonly LedgerTrendPoint[]> => {
    const query = raw as { commodityId?: unknown; bucketMs?: unknown } | null;
    if (typeof query?.commodityId !== "string" || typeof query.bucketMs !== "number") {
      return toWireResult(
        err(domainError("ipc.bad-args", "ledger.trend requires { commodityId, bucketMs }")),
      );
    }
    return toWireResult(ok(deps.ledgerTrend(query as LedgerTrendQuery)));
  });

  ipcMain.handle("alerts.list", (): WireResult<readonly LedgerAlertRule[]> =>
    toWireResult(ok(deps.listAlerts())),
  );

  ipcMain.handle("alerts.add", (raw: unknown): WireResult<readonly LedgerAlertRule[]> => {
    const req = raw as { kind?: unknown; threshold?: unknown } | null;
    if (
      (req?.kind !== "price-threshold" && req?.kind !== "cargo-full") ||
      typeof req.threshold !== "number"
    ) {
      return toWireResult(
        err(domainError("ipc.bad-args", "alerts.add requires { kind, threshold }")),
      );
    }
    return toWireResult(ok(deps.addAlert(raw as AlertRuleRequest)));
  });

  ipcMain.handle("alerts.setEnabled", (raw: unknown): WireResult<readonly LedgerAlertRule[]> => {
    const req = raw as { id?: unknown; enabled?: unknown } | null;
    if (typeof req?.id !== "number" || typeof req.enabled !== "boolean") {
      return toWireResult(
        err(domainError("ipc.bad-args", "alerts.setEnabled requires { id, enabled }")),
      );
    }
    return toWireResult(ok(deps.setAlertEnabled(req.id, req.enabled)));
  });

  ipcMain.handle("alerts.delete", (raw: unknown): WireResult<readonly LedgerAlertRule[]> => {
    const id = (raw as { id?: unknown } | null)?.id;
    if (typeof id !== "number") {
      return toWireResult(err(domainError("ipc.bad-args", "alerts.delete requires { id }")));
    }
    return toWireResult(ok(deps.deleteAlert(id)));
  });
}
