/**
 * The typed API surface exposed to the renderer via contextBridge. This is the
 * ONLY bridge between renderer and main — no raw ipcRenderer is ever exposed
 * (SSOT §5.6 / Step 0.4). Every method returns a plain value or throws a typed
 * error unwrapped from the §5.6 wire envelope.
 */

import type { AppHealth, Channel, WireResult } from "@lodestar/shared";

export interface IpcInvoker {
  invoke: (channel: Channel, ...args: unknown[]) => Promise<unknown>;
}

export interface LodestarApi {
  getHealth: () => Promise<AppHealth>;
}

export const EXPOSED_API_KEYS = ["getHealth"] as const satisfies readonly (keyof LodestarApi)[];

function unwrap<T>(wire: WireResult<T>): T {
  if (wire.ok) return wire.value;
  throw new Error(`${wire.error.code}: ${wire.error.message}`);
}

export function createLodestarApi(ipc: IpcInvoker): LodestarApi {
  return {
    getHealth: async (): Promise<AppHealth> =>
      unwrap(await (ipc.invoke("app.health") as Promise<WireResult<AppHealth>>)),
  };
}
