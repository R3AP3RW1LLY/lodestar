import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { downloadArtifact } from "./artifact-downloader.js";

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function okResponse(bytes: Uint8Array): Response {
  return new Response(bytes, { status: 200 });
}

const PAYLOAD = new TextEncoder().encode("piper-voice-model-bytes");
const GITHUB = "https://github.com/rhasspy/piper/releases/download/v1/voice.onnx";

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

  it("refuses to follow a redirect (pinned artifacts must resolve directly)", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 302, headers: { location: GITHUB } }));
    const r = await downloadArtifact({ url: GITHUB, sha256: sha256(PAYLOAD), fetchFn });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("downloader.http-error");
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
