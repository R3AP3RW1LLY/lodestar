/**
 * Install-time artifact downloader (SSOT §5.4). GET-only, against the INSTALL
 * allowlist, with a mandatory in-repo SHA-256 verification — a hash mismatch
 * refuses and returns no bytes. Real artifact hosts (GitHub releases, HuggingFace
 * LFS) 302 to signed, expiring CDN URLs that cannot be pinned, so redirects ARE
 * followed — but EVERY hop is re-checked against the INSTALL allowlist (like the
 * gateway, §5.4) and an off-allowlist hop fails closed. The committed SHA-256 on
 * the FINAL bytes is the integrity guarantee regardless of which CDN served them.
 * Used only by onboarding/settings flows; never part of the runtime egress path.
 */

import { createHash } from "node:crypto";
import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";
import { INSTALL_ALLOWLIST } from "../gateway/allowlist.js";
import { guardUrl } from "../gateway/url-guard.js";
import type { FetchFn } from "../gateway/gateway.js";

/** Default hard cap on artifact size (Piper voices ~120MB, Whisper small ~0.5GB). */
const DEFAULT_MAX_BYTES = 1_500_000_000;
const DEFAULT_MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface DownloadRequest {
  readonly url: string;
  /** Lowercase hex SHA-256 committed in-repo (never fetched alongside the artifact). */
  readonly sha256: string;
  readonly fetchFn: FetchFn;
  /** Refuse a body larger than this many bytes (default ~1.5 GB). */
  readonly maxBytes?: number;
  /** Max redirect hops to follow, each re-checked against the allowlist (default 5). */
  readonly maxRedirects?: number;
}

/** Read the body chunk-by-chunk, ABORTING once it exceeds the cap (never OOMs on a lying CDN). */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Result<Uint8Array, DomainError>> {
  const body = response.body;
  if (body === null) return ok(new Uint8Array(0));
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    // The web-stream reader is typed `any`-ish across libs; narrow to real bytes.
    const chunk: unknown = result.value;
    if (!(chunk instanceof Uint8Array)) continue;
    total += chunk.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return err(
        domainError("downloader.too-large", `Artifact exceeds the ${String(maxBytes)}-byte cap`),
      );
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return ok(bytes);
}

/** Verify the terminal (non-redirect) response: 200, within the cap, hash-matched. */
async function readVerified(
  response: Response,
  url: string,
  sha256: string,
  maxBytes: number,
): Promise<Result<Uint8Array, DomainError>> {
  if (response.status !== 200) {
    return err(
      domainError(
        "downloader.http-error",
        `Expected 200, got ${String(response.status)} for ${url}`,
      ),
    );
  }
  // Refuse an honestly over-declared body before reading a single byte.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return err(
      domainError(
        "downloader.too-large",
        `Artifact declares ${String(declared)} bytes > cap ${String(maxBytes)}`,
      ),
    );
  }
  const read = await readCapped(response, maxBytes);
  if (!read.ok) return err(read.error);
  const actual = createHash("sha256").update(read.value).digest("hex");
  if (actual !== sha256.toLowerCase()) {
    return err(
      domainError(
        "downloader.hash-mismatch",
        `SHA-256 mismatch for ${url}: expected ${sha256}, got ${actual}`,
      ),
    );
  }
  return ok(read.value);
}

/** Guard a URL against the install allowlist AND require https (install artifacts are never plaintext). */
function guardInstallHop(raw: string): Result<URL, DomainError> {
  const guarded = guardUrl(raw, INSTALL_ALLOWLIST);
  if (!guarded.ok) return guarded;
  if (guarded.value.protocol !== "https:") {
    return err(domainError("downloader.insecure", `Install artifacts must be https, got ${raw}`));
  }
  return guarded;
}

export async function downloadArtifact(
  req: DownloadRequest,
): Promise<Result<Uint8Array, DomainError>> {
  const initial = guardInstallHop(req.url);
  if (!initial.ok) return err(initial.error);
  const maxBytes = req.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = req.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  let current: URL = initial.value;
  for (let hop = 0; ; hop += 1) {
    // Fetch the canonicalized URL the guard validated (not the raw input).
    const response = await req.fetchFn(current.toString(), { method: "GET", redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) {
      return readVerified(response, req.url, req.sha256, maxBytes);
    }
    if (hop >= maxRedirects) {
      return err(
        domainError(
          "downloader.too-many-redirects",
          `More than ${String(maxRedirects)} redirects for ${req.url}`,
        ),
      );
    }
    const location = response.headers.get("location");
    if (location === null || location === "") {
      return err(
        domainError("downloader.bad-redirect", `Redirect with no Location for ${req.url}`),
      );
    }
    let next: URL;
    try {
      next = new URL(location, current); // resolves relative Locations against the current hop
    } catch {
      return err(domainError("downloader.bad-redirect", `Invalid redirect target for ${req.url}`));
    }
    // Per-hop re-check (§5.4): a redirect to an off-allowlist or non-https host fails closed.
    const guarded = guardInstallHop(next.toString());
    if (!guarded.ok) return err(guarded.error);
    current = guarded.value;
  }
}
