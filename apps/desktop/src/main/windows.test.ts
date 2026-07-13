import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindowConstructorOptions } from "electron";

// A minimal Electron BrowserWindow/shell double: it captures the ready-to-show,
// window-open, and will-navigate handlers so the navigation-hardening wiring in
// createMainWindow can be driven and asserted without the real runtime (which is
// otherwise only exercised by the Playwright e2e).
const { openExternal, FakeBrowserWindow } = vi.hoisted(() => {
  const openExternal = vi.fn((): Promise<void> => Promise.resolve());

  interface Captured {
    readyToShow?: () => void;
    windowOpen?: (details: { url: string }) => { action: "deny" };
    willNavigate?: (event: { preventDefault: () => void }, url: string) => void;
  }

  class FakeWebContents {
    readonly captured: Captured = {};
    setWindowOpenHandler(fn: (details: { url: string }) => { action: "deny" }): void {
      this.captured.windowOpen = fn;
    }
    on(event: string, fn: (event: { preventDefault: () => void }, url: string) => void): void {
      if (event === "will-navigate") this.captured.willNavigate = fn;
    }
  }

  class FakeBrowserWindow {
    static last: FakeBrowserWindow | undefined;
    readonly webContents = new FakeWebContents();
    readonly options: BrowserWindowConstructorOptions;
    shown = false;
    loadUrlArg: string | undefined;
    loadFileArg: string | undefined;
    private readyToShow?: () => void;
    constructor(options: BrowserWindowConstructorOptions) {
      this.options = options;
      FakeBrowserWindow.last = this;
    }
    on(event: string, fn: () => void): void {
      if (event === "ready-to-show") this.readyToShow = fn;
    }
    emitReadyToShow(): void {
      this.readyToShow?.();
    }
    show(): void {
      this.shown = true;
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

  return { openExternal, FakeBrowserWindow };
});

vi.mock("electron", () => ({
  BrowserWindow: FakeBrowserWindow,
  shell: { openExternal },
}));

const { createMainWindow, isSafeExternalUrl, isSameOrigin, mainWindowOptions } =
  await import("./windows.js");

describe("mainWindowOptions", () => {
  it("locks in the Electron security flags", () => {
    const opts = mainWindowOptions("/path/preload.cjs");
    expect(opts.webPreferences?.contextIsolation).toBe(true);
    expect(opts.webPreferences?.nodeIntegration).toBe(false);
    expect(opts.webPreferences?.sandbox).toBe(true);
    expect(opts.webPreferences?.webSecurity).toBe(true);
    expect(opts.webPreferences?.preload).toBe("/path/preload.cjs");
  });
});

describe("isSafeExternalUrl", () => {
  it("permits http and https only", () => {
    expect(isSafeExternalUrl("https://edsm.net")).toBe(true);
    expect(isSafeExternalUrl("http://localhost:3000")).toBe(true);
  });

  it("rejects file, UNC, custom protocols, and garbage", () => {
    for (const bad of [
      "file:///C:/windows/system32",
      "\\\\attacker\\share\\x",
      "search-ms:query=x",
      "javascript:alert(1)",
      "vbscript:msgbox",
      "not a url",
    ]) {
      expect(isSafeExternalUrl(bad)).toBe(false);
    }
  });
});

describe("isSameOrigin", () => {
  it("is true only for the exact app origin", () => {
    expect(isSameOrigin("http://localhost:5173/x", "http://localhost:5173")).toBe(true);
    expect(isSameOrigin("http://localhost:5174/x", "http://localhost:5173")).toBe(false);
    expect(isSameOrigin("https://evil.com", "http://localhost:5173")).toBe(false);
    expect(isSameOrigin("garbage", "http://localhost:5173")).toBe(false);
  });
});

describe("createMainWindow", () => {
  beforeEach(() => {
    FakeBrowserWindow.last = undefined;
    openExternal.mockClear();
    delete process.env["ELECTRON_RENDERER_URL"];
  });
  afterEach(() => {
    delete process.env["ELECTRON_RENDERER_URL"];
  });

  it("creates a hidden, hardened window and loads the built renderer file in production", () => {
    createMainWindow();
    const win = FakeBrowserWindow.last;
    expect(win?.options.show).toBe(false);
    expect(win?.options.webPreferences?.sandbox).toBe(true);
    expect(win?.loadFileArg).toContain("renderer");
    expect(win?.loadUrlArg).toBeUndefined();
  });

  it("shows the window only once it is ready-to-show", () => {
    createMainWindow();
    const win = FakeBrowserWindow.last;
    expect(win?.shown).toBe(false);
    win?.emitReadyToShow();
    expect(win?.shown).toBe(true);
  });

  it("denies every new window and routes only safe external links to the OS browser", () => {
    createMainWindow();
    const wc = FakeBrowserWindow.last?.webContents;
    expect(wc?.captured.windowOpen?.({ url: "https://www.edsm.net" })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith("https://www.edsm.net");
    openExternal.mockClear();
    // A non-http(s) scheme is denied AND never handed to the shell.
    expect(wc?.captured.windowOpen?.({ url: "file:///C:/evil" })).toEqual({ action: "deny" });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("blocks cross-origin in-place navigation but allows the app's own file:// origin", () => {
    createMainWindow(); // production → appOrigin is file://
    const wc = FakeBrowserWindow.last?.webContents;
    const sameOrigin = { preventDefault: vi.fn() };
    wc?.captured.willNavigate?.(sameOrigin, "file:///app/index.html");
    expect(sameOrigin.preventDefault).not.toHaveBeenCalled();
    const crossOrigin = { preventDefault: vi.fn() };
    wc?.captured.willNavigate?.(crossOrigin, "https://evil.example/x");
    expect(crossOrigin.preventDefault).toHaveBeenCalled();
    expect(openExternal).toHaveBeenCalledWith("https://evil.example/x");
  });

  it("blocks a cross-origin non-http(s) navigation without handing it to the OS browser", () => {
    createMainWindow(); // production → appOrigin is file://
    const wc = FakeBrowserWindow.last?.webContents;
    const nav = { preventDefault: vi.fn() };
    wc?.captured.willNavigate?.(nav, "about:blank");
    expect(nav.preventDefault).toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("in dev, loads the renderer dev server and locks navigation to its origin", () => {
    process.env["ELECTRON_RENDERER_URL"] = "http://localhost:5173";
    createMainWindow();
    const win = FakeBrowserWindow.last;
    expect(win?.loadUrlArg).toBe("http://localhost:5173");
    expect(win?.loadFileArg).toBeUndefined();
    const wc = win?.webContents;
    const sameOrigin = { preventDefault: vi.fn() };
    wc?.captured.willNavigate?.(sameOrigin, "http://localhost:5173/route");
    expect(sameOrigin.preventDefault).not.toHaveBeenCalled();
    const crossOrigin = { preventDefault: vi.fn() };
    wc?.captured.willNavigate?.(crossOrigin, "http://localhost:5999/x");
    expect(crossOrigin.preventDefault).toHaveBeenCalled();
  });
});
