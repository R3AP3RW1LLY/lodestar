/**
 * The overlay's WS connection info + the argv contract that carries it (Step 2.10).
 * This module is dependency-free (no electron, no node) so BOTH the main process
 * (which builds the `additionalArguments`) and the overlay preload (which parses
 * them) can share it without the preload bundling anything electron-side.
 *
 * The port + token travel as renderer process arguments — never a URL query param
 * and never logged (§5.6). The overlay preload exposes ONLY the parsed result to
 * the overlay renderer; it never exposes any ipcRenderer, so the overlay has no IPC
 * path to main internals (WS-only, asserted).
 */

export const OVERLAY_WS_PORT_FLAG = "--lodestar-ws-port=";
export const OVERLAY_WS_TOKEN_FLAG = "--lodestar-ws-token=";

export interface OverlayConnection {
  readonly port: number;
  readonly token: string;
}

/** Extract the loopback WS port + token from process argv, or undefined if absent/invalid. */
export function parseOverlayConnection(argv: readonly string[]): OverlayConnection | undefined {
  let port: number | undefined;
  let token: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith(OVERLAY_WS_PORT_FLAG)) {
      const n = Number.parseInt(arg.slice(OVERLAY_WS_PORT_FLAG.length), 10);
      if (Number.isInteger(n) && n > 0) port = n;
    } else if (arg.startsWith(OVERLAY_WS_TOKEN_FLAG)) {
      const t = arg.slice(OVERLAY_WS_TOKEN_FLAG.length);
      if (t !== "") token = t;
    }
  }
  if (port === undefined || token === undefined) return undefined;
  return { port, token };
}
