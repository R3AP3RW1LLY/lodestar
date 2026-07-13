/**
 * The typed API surface exposed to the renderer via contextBridge. This is the
 * ONLY bridge between renderer and main — no raw ipcRenderer is ever exposed
 * (SSOT §5.6 / Step 0.4). Invoke methods return a plain value or throw a typed
 * error unwrapped from the §5.6 wire envelope; push subscriptions (Step 1.9)
 * deliver only validated envelope payloads and return an unsubscribe handle.
 */

import type {
  AppHealth,
  Channel,
  GpuInfo,
  RootState,
  SecretsPresence,
  SecretsSetRequest,
  SessionSummary,
  SettingsSetRequest,
  SettingsSnapshot,
  StateDelta,
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
  };
}
