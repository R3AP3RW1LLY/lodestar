import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { downloadArtifact } from "./artifact-downloader.js";
import type { FetchFn } from "../gateway/gateway.js";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function okResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200 });
}

/** A fetch transport that routes each exact URL to a fresh Response (single-use bodies). */
function router(routes: Record<string, () => Response>): FetchFn {
  return (url: string) => {
    const make = routes[url];
    return Promise.resolve(make === undefined ? new Response("no route", { status: 500 }) : make());
  };
}

const PAYLOAD = new TextEncoder().encode("piper-voice-model-bytes");
const GITHUB = "https://github.com/rhasspy/piper/releases/download/v1/voice.onnx";
const GH_CDN = "https://release-assets.githubusercontent.com/asset/123?sig=abc&se=2026";
const HF_JSON = "https://huggingface.co/rhasspy/piper-voices/resolve/main/x.onnx.json";

describe("downloadArtifact", () => {
  it("downloads from an install-allowlisted host and verifies the SHA-256", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse(PAYLOAD));
    const r = await downloadArtifact({ url: GITHUB, sha256: sha256(PAYLOAD), fetchFn });
    expect(r.ok).toBe(true);
    if (r.ok) expect(new TextDecoder().decode(r.value)).toBe("piper-voice-model-bytes");
    // GET only.
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ method: "GET", redirect: "manual" });
  });

  it("REFUSES on a hash mismatch and returns no bytes", async () => {
    const fetchFn = vi.fn().mockResolvedValue(okResponse(PAYLOAD));
    const r = await downloadArtifact({ url: GITHUB, sha256: "0".repeat(64), fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("downloader.hash-mismatch");
  });

  it("refuses a URL whose host is not in the INSTALL allowlist", async () => {
    const fetchFn = vi.fn();
    const r = await downloadArtifact({
      url: "https://evil.example.com/model.onnx",
      sha256: sha256(PAYLOAD),
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("egress.host-not-allowed");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a runtime-only allowlisted host (EDSM etc. are not artifact sources)", async () => {
    const fetchFn = vi.fn();
    const r = await downloadArtifact({
      url: "https://www.edsm.net/model.onnx",
      sha256: sha256(PAYLOAD),
      fetchFn,
    });
    expect(r.ok).toBe(false);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("refuses a non-200 response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    const r = await downloadArtifact({ url: GITHUB, sha256: sha256(PAYLOAD), fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("downloader.http-error");
  });

  it("follows an allowlisted redirect (GitHub → release-assets CDN) and hash-verifies", async () => {
    const fetchFn = router({
      [GITHUB]: () => new Response("", { status: 302, headers: { location: GH_CDN } }),
      [GH_CDN]: () => okResponse(PAYLOAD),
    });
    const r = await downloadArtifact({ url: GITHUB, sha256: sha256(PAYLOAD), fetchFn });
    expect(r.ok).toBe(true);
    if (r.ok) expect(new TextDecoder().decode(r.value)).toBe("piper-voice-model-bytes");
  });

  it("follows a RELATIVE redirect on the same host (HuggingFace resolve-cache)", async () => {
    const fetchFn = router({
      [HF_JSON]: () =>
        new Response("", {
          status: 307,
          headers: { location: "/api/resolve-cache/x.onnx.json?e=1" },
        }),
      ["https://huggingface.co/api/resolve-cache/x.onnx.json?e=1"]: () => okResponse(PAYLOAD),
    });
    const r = await downloadArtifact({ url: HF_JSON, sha256: sha256(PAYLOAD), fetchFn });
    expect(r.ok).toBe(true);
  });

  it("FAILS CLOSED on a redirect to an off-allowlist host", async () => {
    const fetchFn = router({
      [GITHUB]: () =>
        new Response("", { status: 302, headers: { location: "https://evil.example.com/x" } }),
    });
    const r = await downloadArtifact({ url: GITHUB, sha256: sha256(PAYLOAD), fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("egress.host-not-allowed");
  });

  it("refuses a redirect chain longer than maxRedirects (loop protection)", async () => {
    // A self-redirect loop on an allowlisted host would otherwise spin forever.
    const fetchFn: FetchFn = () =>
      Promise.resolve(new Response("", { status: 302, headers: { location: GITHUB } }));
    const r = await downloadArtifact({
      url: GITHUB,
      sha256: sha256(PAYLOAD),
      fetchFn,
      maxRedirects: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("downloader.too-many-redirects");
  });

  it("refuses a redirect with no Location header", async () => {
    const fetchFn: FetchFn = () => Promise.resolve(new Response("", { status: 302 }));
    const r = await downloadArtifact({ url: GITHUB, sha256: sha256(PAYLOAD), fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("downloader.bad-redirect");
  });

  it("still enforces the SHA-256 on the FINAL bytes after following redirects", async () => {
    const fetchFn = router({
      [GITHUB]: () => new Response("", { status: 302, headers: { location: GH_CDN } }),
      [GH_CDN]: () => okResponse(PAYLOAD),
    });
    const r = await downloadArtifact({ url: GITHUB, sha256: "0".repeat(64), fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("downloader.hash-mismatch");
  });

  it("refuses a PROTOCOL-RELATIVE redirect to an off-allowlist host (//evil)", async () => {
    const fetchFn = router({
      [GITHUB]: () =>
        new Response("", { status: 302, headers: { location: "//evil.example.com/x" } }),
    });
    const r = await downloadArtifact({ url: GITHUB, sha256: sha256(PAYLOAD), fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("egress.host-not-allowed"); // //evil → https://evil…
  });

  it("refuses a SCHEME-DOWNGRADE redirect (https → http on an allowlisted host)", async () => {
    const fetchFn = router({
      [GITHUB]: () =>
        new Response("", { status: 302, headers: { location: "http://github.com/x" } }),
    });
    const r = await downloadArtifact({ url: GITHUB, sha256: sha256(PAYLOAD), fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("downloader.insecure");
  });

  it("refuses a plaintext (http) initial URL outright", async () => {
    const fetchFn = router({});
    const r = await downloadArtifact({
      url: "http://github.com/rhasspy/piper/releases/download/v1/x.zip",
      sha256: sha256(PAYLOAD),
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("downloader.insecure");
  });

  it("refuses an over-cap body (declared Content-Length beyond maxBytes)", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(PAYLOAD, { status: 200, headers: { "content-length": "999999999" } }),
      );
    const r = await downloadArtifact({
      url: GITHUB,
      sha256: sha256(PAYLOAD),
      fetchFn,
      maxBytes: 1000,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("downloader.too-large");
    // Never even hashes an over-declared body.
  });

  it("refuses an over-cap body that lies about (omits) Content-Length", async () => {
    const big = new Uint8Array(5000);
    const fetchFn = vi.fn().mockResolvedValue(new Response(big, { status: 200 }));
    const r = await downloadArtifact({ url: GITHUB, sha256: sha256(big), fetchFn, maxBytes: 1000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("downloader.too-large");
  });
});
