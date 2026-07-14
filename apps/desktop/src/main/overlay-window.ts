/**
 * The in-game overlay window (SSOT Step 2.10). A frameless, transparent,
 * always-on-top, CLICK-THROUGH window that shows the latest verdict + cargo % over
 * the borderless-windowed game. It is display-only and receives its telemetry
 * exclusively over the loopback WS server — it has NO preload IPC bridge to main
 * internals. The only thing its preload exposes is the WS connection info (port +
 * token), handed over via `additionalArguments` (renderer argv) — never a URL query
 * param, never logged (§5.6).
 *
 * `overlayWindowOptions` is pure + asserted in tests (the security + click-through
 * flags matter); `createOverlayWindow` is the thin Electron glue (like
 * `createMainWindow`), not unit-tested.
 */

import { join } from "node:path";
import { BrowserWindow } from "electron";
import type { BrowserWindowConstructorOptions } from "electron";
import type { Logger } from "@lodestar/shared";
import { OVERLAY_WS_PORT_FLAG, OVERLAY_WS_TOKEN_FLAG } from "../overlay-connection.js";

// Re-exported so main-side consumers (and the window test) have one import site.
export { OVERLAY_WS_PORT_FLAG, OVERLAY_WS_TOKEN_FLAG };

export interface OverlayWindowConfig {
  readonly preloadPath: string;
  readonly wsPort: number;
  readonly wsToken: string;
}

/** Pure, testable overlay window options — the security + click-through flags are asserted. */
export function overlayWindowOptions(config: OverlayWindowConfig): BrowserWindowConstructorOptions {
  return {
    width: 380,
    height: 260,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // Never steal focus from the game — the overlay is display-only.
    focusable: false,
    hasShadow: false,
    alwaysOnTop: true,
    webPreferences: {
      preload: config.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // The overlay preload reads `additionalArguments` (process.argv) to learn the
      // WS port+token WITHOUT any IPC to main; that needs a non-sandboxed preload.
      // The renderer itself stays isolated (contextIsolation on, nodeIntegration off)
      // and loads only our own local content.
      sandbox: false,
      webSecurity: true,
      additionalArguments: [
        `${OVERLAY_WS_PORT_FLAG}${String(config.wsPort)}`,
        `${OVERLAY_WS_TOKEN_FLAG}${config.wsToken}`,
      ],
    },
  };
}

export interface OverlayHandle {
  readonly window: BrowserWindow;
  /** Toggle visibility; returns the new visibility. */
  toggle: () => boolean;
  show: () => void;
  hide: () => void;
  isVisible: () => boolean;
  destroy: () => void;
}

export interface OverlayWindowDeps {
  readonly wsPort: number;
  readonly wsToken: string;
  readonly logger?: Logger;
}

export function createOverlayWindow(deps: OverlayWindowDeps): OverlayHandle {
  const preloadPath = join(import.meta.dirname, "../preload/overlay.cjs");
  const window = new BrowserWindow(
    overlayWindowOptions({ preloadPath, wsPort: deps.wsPort, wsToken: deps.wsToken }),
  );

  // Click-through: every mouse event passes to the game beneath. This is the core
  // ToS-safe guarantee — the overlay can never receive (or forward) input to a
  // control. Combined with the renderer's `pointerEvents: none`, it is belt + braces.
  window.setIgnoreMouseEvents(true);
  // Float above a borderless-windowed game, even over fullscreen UI.
  window.setAlwaysOnTop(true, "screen-saver");

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl !== undefined) {
    void window.loadURL(`${devServerUrl}/overlay.html`);
  } else {
    void window.loadFile(join(import.meta.dirname, "../renderer/overlay.html"));
  }

  // Show WITHOUT activating — the overlay must never take focus from the game.
  const show = (): void => {
    window.showInactive();
  };
  const hide = (): void => {
    window.hide();
  };

  deps.logger?.info("overlay.created", { wsPort: deps.wsPort });

  return {
    window,
    isVisible: () => !window.isDestroyed() && window.isVisible(),
    show,
    hide,
    toggle: () => {
      if (window.isVisible()) {
        hide();
        return false;
      }
      show();
      return true;
    },
    destroy: () => {
      if (!window.isDestroyed()) window.destroy();
    },
  };
}
