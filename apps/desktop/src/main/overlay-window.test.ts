import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindowConstructorOptions } from "electron";

// A minimal Electron BrowserWindow double so createOverlayWindow's glue — the
// click-through + always-on-top wiring and the show/hide/toggle lifecycle — can be
// driven and asserted without the real runtime (otherwise only exercised manually
// over the game per docs/verification/phase-2.md).
const { FakeBrowserWindow } = vi.hoisted(() => {
  class FakeBrowserWindow {
    static last: FakeBrowserWindow | undefined;
    readonly options: BrowserWindowConstructorOptions;
    ignoreMouse: boolean | undefined;
    alwaysOnTopLevel: string | undefined;
    visible = false;
    destroyed = false;
    loadUrlArg: string | undefined;
    loadFileArg: string | undefined;
    constructor(options: BrowserWindowConstructorOptions) {
      this.options = options;
      FakeBrowserWindow.last = this;
    }
    setIgnoreMouseEvents(value: boolean): void {
      this.ignoreMouse = value;
    }
    setAlwaysOnTop(_value: boolean, level?: string): void {
      this.alwaysOnTopLevel = level;
    }
    showInactive(): void {
      this.visible = true;
    }
    hide(): void {
      this.visible = false;
    }
    isVisible(): boolean {
      return this.visible;
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    destroy(): void {
      this.destroyed = true;
    }
    loadURL(url: string): Promise<void> {
      this.loadUrlArg = url;
      return Promise.resolve();
    }
    loadFile(file: string): Promise<void> {
      this.loadFileArg = file;
      return Promise.resolve();
    }
  }
  return { FakeBrowserWindow };
});

vi.mock("electron", () => ({ BrowserWindow: FakeBrowserWindow }));

const { OVERLAY_WS_PORT_FLAG, OVERLAY_WS_TOKEN_FLAG, overlayWindowOptions, createOverlayWindow } =
  await import("./overlay-window.js");

describe("overlayWindowOptions", () => {
  const opts = overlayWindowOptions({
    preloadPath: "/p/overlay.cjs",
    wsPort: 4321,
    wsToken: "tok",
  });

  it("is frameless, transparent, always-on-top, and off the taskbar", () => {
    expect(opts.frame).toBe(false);
    expect(opts.transparent).toBe(true);
    expect(opts.alwaysOnTop).toBe(true);
    expect(opts.skipTaskbar).toBe(true);
    expect(opts.show).toBe(false);
  });

  it("never steals focus and cannot be resized/maximized", () => {
    expect(opts.focusable).toBe(false);
    expect(opts.resizable).toBe(false);
    expect(opts.maximizable).toBe(false);
    expect(opts.fullscreenable).toBe(false);
  });

  it("keeps the renderer isolated (contextIsolation on, nodeIntegration off)", () => {
    expect(opts.webPreferences?.contextIsolation).toBe(true);
    expect(opts.webPreferences?.nodeIntegration).toBe(false);
    expect(opts.webPreferences?.preload).toBe("/p/overlay.cjs");
  });

  it("hands the WS port + token to the preload via additionalArguments (never a URL/query)", () => {
    const args = opts.webPreferences?.additionalArguments ?? [];
    expect(args).toContain(`${OVERLAY_WS_PORT_FLAG}4321`);
    expect(args).toContain(`${OVERLAY_WS_TOKEN_FLAG}tok`);
  });
});

describe("createOverlayWindow", () => {
  beforeEach(() => {
    FakeBrowserWindow.last = undefined;
    delete process.env["ELECTRON_RENDERER_URL"];
  });
  afterEach(() => {
    delete process.env["ELECTRON_RENDERER_URL"];
  });

  it("is click-through and always-on-top, and loads the built overlay file in production", () => {
    createOverlayWindow({ wsPort: 4321, wsToken: "tok" });
    const win = FakeBrowserWindow.last;
    // The core ToS guarantee: the overlay ignores mouse input (never drives a control).
    expect(win?.ignoreMouse).toBe(true);
    expect(win?.alwaysOnTopLevel).toBe("screen-saver");
    expect(win?.options.transparent).toBe(true);
    expect(win?.loadFileArg).toContain("overlay.html");
    expect(win?.loadUrlArg).toBeUndefined();
  });

  it("loads the overlay dev URL in dev", () => {
    process.env["ELECTRON_RENDERER_URL"] = "http://localhost:5173";
    createOverlayWindow({ wsPort: 1, wsToken: "t" });
    expect(FakeBrowserWindow.last?.loadUrlArg).toBe("http://localhost:5173/overlay.html");
  });

  it("toggles visibility, showing WITHOUT activating (never steals focus)", () => {
    const handle = createOverlayWindow({ wsPort: 1, wsToken: "t" });
    expect(handle.isVisible()).toBe(false);
    expect(handle.toggle()).toBe(true);
    expect(handle.isVisible()).toBe(true);
    expect(handle.toggle()).toBe(false);
    expect(handle.isVisible()).toBe(false);
  });

  it("destroy() destroys the window and isVisible() then reports false", () => {
    const handle = createOverlayWindow({ wsPort: 1, wsToken: "t" });
    handle.show();
    handle.destroy();
    expect(FakeBrowserWindow.last?.destroyed).toBe(true);
    expect(handle.isVisible()).toBe(false);
  });
});
