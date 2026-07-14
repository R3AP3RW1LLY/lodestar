/**
 * The overlay preload (SSOT Step 2.10). Unlike the main preload, it exposes NO
 * ipcRenderer, no invoke, no push subscriptions — the overlay reaches main ONLY
 * over the loopback WS server. All this bridge hands the renderer is the WS
 * connection info (port + token), read from process argv (main passed it via
 * `additionalArguments`). That keeps the overlay provably WS-only: it has zero IPC
 * surface to main internals. `installOverlayBridge` is factored out so a test can
 * assert exactly one exposure of exactly the "lodestarOverlay" key.
 */

import { contextBridge } from "electron";
import { parseOverlayConnection } from "../overlay-connection.js";

export interface OverlayBridgeHost {
  exposeInMainWorld: (key: string, api: unknown) => void;
}

export function installOverlayBridge(bridge: OverlayBridgeHost, argv: readonly string[]): void {
  // null (not undefined) when the args are absent, so the renderer can tell "no
  // connection info" from "not yet asked".
  bridge.exposeInMainWorld("lodestarOverlay", parseOverlayConnection(argv) ?? null);
}

// Auto-install only in the real preload runtime (electron present). Under the Node
// test runner the electron named exports are undefined, so this is skipped and
// installOverlayBridge is exercised directly.
if (contextBridge as OverlayBridgeHost | undefined) {
  installOverlayBridge(contextBridge, process.argv);
}
