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
import type { BrowserWindowConstructorOptions, Rectangle } from "electron";
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
  /**
   * Apply the lock state. LOCKED = click-through, immovable, non-resizable,
   * non-focusable (display-only, safe during flight). UNLOCKED = interactive so
   * the commander can drag/resize it (the "arrange" state).
   */
  setLocked: (locked: boolean) => void;
  /** Flip the lock and return the new state. */
  toggleLock: () => boolean;
  isLocked: () => boolean;
  getBounds: () => Rectangle;
  /** Notified after the user finishes a move/resize (arrange mode) — for persistence. */
  onBoundsChanged: (fn: (bounds: Rectangle) => void) => void;
  destroy: () => void;
}

export interface OverlayWindowDeps {
  readonly wsPort: number;
  readonly wsToken: string;
  readonly logger?: Logger;
  /** Restore the commander's saved position/size (arrange mode persistence). */
  readonly initialBounds?: Rectangle;
  /** Restore the saved lock state (default locked). */
  readonly initialLocked?: boolean;
}

export function createOverlayWindow(deps: OverlayWindowDeps): OverlayHandle {
  const preloadPath = join(import.meta.dirname, "../preload/overlay.cjs");
  const window = new BrowserWindow(
    overlayWindowOptions({ preloadPath, wsPort: deps.wsPort, wsToken: deps.wsToken }),
  );

  // Float above a borderless-windowed game, even over fullscreen UI.
  window.setAlwaysOnTop(true, "screen-saver");
  if (deps.initialBounds !== undefined) window.setBounds(deps.initialBounds);

  // The lock governs click-through + interactivity. LOCKED is the core ToS-safe
  // guarantee: every mouse event passes to the game beneath (the overlay can never
  // receive or forward input to a control), and the window can't be moved, resized,
  // or focused. UNLOCKED lets the commander deliberately arrange the HUD.
  let locked = true;
  const applyLock = (next: boolean): void => {
    locked = next;
    window.setIgnoreMouseEvents(next);
    window.setMovable(!next);
    window.setResizable(!next);
    window.setFocusable(!next);
  };
  applyLock(deps.initialLocked ?? true);

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl !== undefined) {
    void window.loadURL(`${devServerUrl}/overlay.html`);
  } else {
    void window.loadFile(join(import.meta.dirname, "../renderer/overlay.html"));
  }

  // Persist the commander's placement only after they FINISH a drag/resize.
  const boundsListeners: ((bounds: Rectangle) => void)[] = [];
  const emitBounds = (): void => {
    if (window.isDestroyed()) return;
    const bounds = window.getBounds();
    for (const fn of boundsListeners) fn(bounds);
  };
  window.on("moved", emitBounds);
  window.on("resized", emitBounds);

  // Show WITHOUT activating — the overlay must never take focus from the game.
  const show = (): void => {
    window.showInactive();
  };
  const hide = (): void => {
    window.hide();
  };

  deps.logger?.info("overlay.created", { wsPort: deps.wsPort, locked });

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
    setLocked: applyLock,
    toggleLock: () => {
      applyLock(!locked);
      return locked;
    },
    isLocked: () => locked,
    getBounds: () => window.getBounds(),
    onBoundsChanged: (fn) => {
      boundsListeners.push(fn);
    },
    destroy: () => {
      if (!window.isDestroyed()) window.destroy();
    },
  };
}
