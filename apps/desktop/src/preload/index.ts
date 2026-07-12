/**
 * Preload bridge. Exposes ONLY the typed lodestar API over contextBridge; the
 * raw ipcRenderer is never handed to the renderer (SSOT §5.6 / Step 0.4). The
 * installation is factored into installBridge so a test can assert exactly one
 * exposure, of exactly the "lodestar" key.
 */

import { contextBridge, ipcRenderer } from "electron";
import { createLodestarApi } from "./api.js";

export interface BridgeHost {
  exposeInMainWorld: (key: string, api: unknown) => void;
}

export interface InvokeHost {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

export function installBridge(bridge: BridgeHost, invoker: InvokeHost): void {
  const api = createLodestarApi({
    invoke: (channel, ...args) => invoker.invoke(channel, ...args),
  });
  bridge.exposeInMainWorld("lodestar", api);
}

// Auto-install only in the real preload runtime (electron present). Under the
// Node test runner the electron named exports are undefined, so this is skipped
// and installBridge is exercised directly with test doubles.
if (contextBridge as BridgeHost | undefined) {
  installBridge(contextBridge, ipcRenderer);
}
