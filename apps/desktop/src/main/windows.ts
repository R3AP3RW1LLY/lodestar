/**
 * Window creation and navigation hardening. The main window is created hidden
 * and shown on ready-to-show. contextIsolation is on, nodeIntegration off,
 * sandbox on — the renderer reaches main only through the typed preload bridge.
 * Navigation is locked to the app origin and external links are scheme-checked
 * (Electron security checklist items 12–14), because later phases render
 * journal/integration-derived strings that must never become a navigation or
 * shell.openExternal primitive.
 */

import { join } from "node:path";
import { BrowserWindow, shell } from "electron";
import type { BrowserWindowConstructorOptions } from "electron";

/** Pure, testable window options — the security flags are asserted in tests. */
export function mainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: "#0a0a0f",
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
}

/** Only http/https links may be handed to the OS browser (blocks file:, UNC, custom protocols). */
export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/** In-place navigation is allowed only within the app's own origin. */
export function isSameOrigin(target: string, appOrigin: string): boolean {
  try {
    return new URL(target).origin === appOrigin;
  } catch {
    return false;
  }
}

export function createMainWindow(): BrowserWindow {
  const preloadPath = join(import.meta.dirname, "../preload/index.cjs");
  const window = new BrowserWindow(mainWindowOptions(preloadPath));

  window.on("ready-to-show", () => {
    window.show();
  });

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  const appOrigin = devServerUrl !== undefined ? new URL(devServerUrl).origin : "file://";

  // Deny all new windows; route only safe external links to the OS browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // Lock in-place navigation to the app origin (file:// navigations are same-origin).
  window.webContents.on("will-navigate", (event, url) => {
    if (!(appOrigin === "file://" ? url.startsWith("file://") : isSameOrigin(url, appOrigin))) {
      event.preventDefault();
      if (isSafeExternalUrl(url)) void shell.openExternal(url);
    }
  });

  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
  } else {
    void window.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }

  return window;
}
