import { describe, expect, it } from "vitest";
import { isSafeExternalUrl, isSameOrigin, mainWindowOptions } from "./windows.js";

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
