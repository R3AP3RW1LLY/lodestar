/**
 * The typed API surface exposed to the renderer via contextBridge. This is the
 * ONLY bridge between renderer and main — no raw ipcRenderer is ever exposed
 * (SSOT §5.6 / Step 0.4). Invoke methods return a plain value or throw a typed
 * error unwrapped from the §5.6 wire envelope; push subscriptions (Step 1.9)
 * deliver only validated envelope payloads and return an unsubscribe handle.
 */

import type {
  AlertIdRequest,
  AlertRuleRequest,
  AlertToggleRequest,
  AnalyticsExportRequest,
  AnalyticsExportResult,
  AppHealth,
  AssayVerdictEvent,
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
  PlanStrategy,
  RunPlanView,
  SavePlanResult,
  VeinCandidate,
  VeinFilter,
  RootState,
  SessionDetail,
  SessionFilter,
  SecretsPresence,
  SecretsSetRequest,
  SessionSummary,
  SettingsSetRequest,
  SettingsSnapshot,
  StateDelta,
  TtsAudio,
  TtsTestResult,
  TtsVoiceOption,
  WireResult,
} from "@lodestar/shared";
import { isEnvelope } from "@lodestar/shared";

export interface IpcInvoker {
  invoke: (channel: Channel, ...args: unknown[]) => Promise<unknown>;
  /** Subscribe to a main→renderer push channel; returns an unsubscribe fn. */
  on: (channel: Channel, listener: (message: unknown) => void) => () => void;
}

export type Unsubscribe = () => void;

export interface LodestarApi {
  getHealth: () => Promise<AppHealth>;
  getSettings: () => Promise<SettingsSnapshot>;
  setSetting: (req: SettingsSetRequest) => Promise<SettingsSnapshot>;
  autodetectJournal: () => Promise<{ path: string | null }>;
  getSecretsPresence: () => Promise<SecretsPresence>;
  setSecret: (req: SecretsSetRequest) => Promise<SecretsPresence>;
  listGpus: () => Promise<readonly GpuInfo[]>;
  /** Fetch the current full state (and re-baseline the delta stream) on subscribe. */
  getStateSnapshot: () => Promise<RootState>;
  onStateDelta: (cb: (delta: StateDelta) => void) => Unsubscribe;
  onSessionStats: (cb: (session: SessionSummary | null) => void) => Unsubscribe;
  /** Settings test-phrase button — synthesize + play a callout, report success. */
  testTts: () => Promise<TtsTestResult>;
  /** The pinned TTS voice options for the Settings picker. */
  listVoices: () => Promise<readonly TtsVoiceOption[]>;
  /** Subscribe to synthesized verdict callouts pushed from main (for playback). */
  onTtsAudio: (cb: (audio: TtsAudio) => void) => Unsubscribe;
  /** Subscribe to Assay verdicts pushed from main (for the Assay dashboard). */
  onAssayVerdict: (cb: (verdict: AssayVerdictEvent) => void) => Unsubscribe;
  /** Toggle the in-game overlay window; resolves with its new visibility. */
  toggleOverlay: () => Promise<OverlayToggleResult>;
  /** Toggle the overlay lock (click-through ⇄ arrange); resolves with its new mode. */
  lockOverlay: () => Promise<OverlayMode>;
  /** Export an analytics dataset to CSV via a native save dialog. */
  exportAnalytics: (req: AnalyticsExportRequest) => Promise<AnalyticsExportResult>;
  /** Fetch the full Manifest analytics bundle for a filter. */
  getManifest: (filter: SessionFilter) => Promise<ManifestData>;
  getLedgerBoard: () => Promise<readonly LedgerBoardEntry[]>;
  getLedgerStations: (query: LedgerStationQuery) => Promise<readonly LedgerStation[]>;
  getLedgerTrend: (query: LedgerTrendQuery) => Promise<readonly LedgerTrendPoint[]>;
  listAlerts: () => Promise<readonly LedgerAlertRule[]>;
  addAlert: (request: AlertRuleRequest) => Promise<readonly LedgerAlertRule[]>;
  setAlertEnabled: (request: AlertToggleRequest) => Promise<readonly LedgerAlertRule[]>;
  deleteAlert: (request: AlertIdRequest) => Promise<readonly LedgerAlertRule[]>;
  planRuns: (strategy: PlanStrategy) => Promise<readonly RunPlanView[]>;
  savePlan: (index: number) => Promise<SavePlanResult>;
  findVeins: (filter: VeinFilter) => Promise<readonly VeinCandidate[]>;
  /** Fetch one session's drill-down detail (null if unknown). */
  getSessionDetail: (sessionId: number) => Promise<SessionDetail | null>;
}

export const EXPOSED_API_KEYS = [
  "getHealth",
  "getSettings",
  "setSetting",
  "autodetectJournal",
  "getSecretsPresence",
  "setSecret",
  "listGpus",
  "getStateSnapshot",
  "onStateDelta",
  "onSessionStats",
  "testTts",
  "listVoices",
  "onTtsAudio",
  "onAssayVerdict",
  "toggleOverlay",
  "lockOverlay",
  "exportAnalytics",
  "getManifest",
  "getSessionDetail",
  "getLedgerBoard",
  "getLedgerStations",
  "getLedgerTrend",
  "listAlerts",
  "addAlert",
  "setAlertEnabled",
  "deleteAlert",
  "planRuns",
  "savePlan",
  "findVeins",
] as const satisfies readonly (keyof LodestarApi)[];

function unwrap<T>(wire: WireResult<T>): T {
  if (wire.ok) return wire.value;
  throw new Error(`${wire.error.code}: ${wire.error.message}`);
}

export function createLodestarApi(ipc: IpcInvoker): LodestarApi {
  const call = async <T>(channel: Channel, ...args: unknown[]): Promise<T> =>
    unwrap(await (ipc.invoke(channel, ...args) as Promise<WireResult<T>>));

  // Deliver only well-formed envelopes for the expected channel — a malformed or
  // wrong-channel message is dropped, never handed to the renderer callback. The
  // payload is left unvalidated by isEnvelope, so also require the coarse shape
  // these push channels use (object or null) before casting at the consumer.
  const subscribe = (channel: Channel, cb: (payload: unknown) => void): Unsubscribe =>
    ipc.on(channel, (message) => {
      if (!isEnvelope(message) || message.channel !== channel) return;
      const payload = message.payload;
      if (payload === null || typeof payload === "object") cb(payload);
    });

  return {
    getHealth: () => call<AppHealth>("app.health"),
    getSettings: () => call<SettingsSnapshot>("settings.get"),
    setSetting: (req) => call<SettingsSnapshot>("settings.set", req),
    autodetectJournal: () => call<{ path: string | null }>("journal.autodetect"),
    getSecretsPresence: () => call<SecretsPresence>("secrets.presence"),
    setSecret: (req) => call<SecretsPresence>("secrets.set", req),
    listGpus: () => call<readonly GpuInfo[]>("system.gpus"),
    getStateSnapshot: () => call<RootState>("state.snapshot"),
    onStateDelta: (cb) =>
      subscribe("state.delta", (p) => {
        cb(p as StateDelta);
      }),
    onSessionStats: (cb) =>
      subscribe("session.stats", (p) => {
        cb(p as SessionSummary | null);
      }),
    testTts: () => call<TtsTestResult>("tts.test"),
    listVoices: () => call<readonly TtsVoiceOption[]>("tts.voices"),
    onTtsAudio: (cb) =>
      subscribe("tts.audio", (p) => {
        cb(p as TtsAudio);
      }),
    onAssayVerdict: (cb) =>
      subscribe("assay.verdict", (p) => {
        cb(p as AssayVerdictEvent);
      }),
    toggleOverlay: () => call<OverlayToggleResult>("overlay.toggle"),
    lockOverlay: () => call<OverlayMode>("overlay.lock"),
    exportAnalytics: (req) => call<AnalyticsExportResult>("analytics.export", req),
    getManifest: (filter) => call<ManifestData>("analytics.manifest", filter),
    getSessionDetail: (sessionId) =>
      call<SessionDetail | null>("analytics.sessionDetail", { sessionId }),
    getLedgerBoard: () => call<readonly LedgerBoardEntry[]>("ledger.board"),
    getLedgerStations: (query) => call<readonly LedgerStation[]>("ledger.stations", query),
    getLedgerTrend: (query) => call<readonly LedgerTrendPoint[]>("ledger.trend", query),
    listAlerts: () => call<readonly LedgerAlertRule[]>("alerts.list"),
    addAlert: (request) => call<readonly LedgerAlertRule[]>("alerts.add", request),
    setAlertEnabled: (request) => call<readonly LedgerAlertRule[]>("alerts.setEnabled", request),
    deleteAlert: (request) => call<readonly LedgerAlertRule[]>("alerts.delete", request),
    planRuns: (strategy) => call<readonly RunPlanView[]>("planner.plan", { strategy }),
    savePlan: (index) => call<SavePlanResult>("planner.save", { index }),
    findVeins: (filter) => call<readonly VeinCandidate[]>("veins.find", filter),
  };
}
