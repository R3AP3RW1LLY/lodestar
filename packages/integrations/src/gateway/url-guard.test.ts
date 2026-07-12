import { describe, expect, it } from "vitest";
import { guardUrl } from "./url-guard.js";
import { RUNTIME_ALLOWLIST } from "./allowlist.js";

describe("guardUrl", () => {
  it("accepts an allowlisted https host", () => {
    const r = guardUrl("https://www.edsm.net/api/v1/system?systemName=Sol", RUNTIME_ALLOWLIST);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.hostname).toBe("www.edsm.net");
  });

  it("refuses a non-allowlisted host", () => {
    const r = guardUrl("https://api.openai.com/v1/chat", RUNTIME_ALLOWLIST);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("egress.host-not-allowed");
  });

  it("refuses a subdomain of an allowlisted host (exact match only)", () => {
    expect(guardUrl("https://evil.www.edsm.net", RUNTIME_ALLOWLIST).ok).toBe(false);
    expect(guardUrl("https://www.edsm.net.evil.com", RUNTIME_ALLOWLIST).ok).toBe(false);
  });

  it("refuses non-http(s) schemes", () => {
    for (const url of [
      "ftp://www.edsm.net",
      "file:///etc/passwd",
      "ws://www.edsm.net",
      "data:text/html,x",
    ]) {
      expect(guardUrl(url, RUNTIME_ALLOWLIST).ok).toBe(false);
    }
  });

  it("refuses userinfo tricks even with an allowlisted host in the URL", () => {
    // Real host is api.openai.com; the allowlisted name is only userinfo.
    expect(guardUrl("https://www.edsm.net@api.openai.com", RUNTIME_ALLOWLIST).ok).toBe(false);
    expect(guardUrl("https://user:pass@www.edsm.net", RUNTIME_ALLOWLIST).ok).toBe(false);
    // Backslash parser-differential: WHATWG resolves the real host to
    // api.openai.com even though the string appears to end in www.edsm.net.
    expect(guardUrl("https://api.openai.com\\@www.edsm.net", RUNTIME_ALLOWLIST).ok).toBe(false);
  });

  it("refuses IP hosts (allowlist is hostnames; loopback needs allowLoopback)", () => {
    expect(guardUrl("https://127.0.0.1:11434", RUNTIME_ALLOWLIST).ok).toBe(false);
  });

  it("accepts literal loopback only when allowLoopback is set, canonical form only", () => {
    expect(guardUrl("http://127.0.0.1:11434", new Set<string>(), { allowLoopback: true }).ok).toBe(
      true,
    );
    // Encoded loopback tricks are still refused.
    for (const url of [
      "http://2130706433",
      "http://0x7f000001",
      "http://127.1",
      "http://localhost:11434",
    ]) {
      expect(guardUrl(url, new Set<string>(), { allowLoopback: true }).ok).toBe(false);
    }
  });

  it("refuses garbage URLs without throwing", () => {
    expect(guardUrl("not a url", RUNTIME_ALLOWLIST).ok).toBe(false);
    expect(guardUrl("", RUNTIME_ALLOWLIST).ok).toBe(false);
  });
});
