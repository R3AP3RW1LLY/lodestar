/**
 * Install-time artifact downloader (SSOT §5.4). GET-only, against the INSTALL
 * allowlist, with a mandatory in-repo SHA-256 verification — a hash mismatch
 * refuses and returns no bytes. Redirects are NOT followed (pinned artifact
 * URLs must resolve directly). Used only by onboarding/settings flows; it is
 * never part of the runtime egress path.
 */

import { createHash } from "node:crypto";
import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";
import { INSTALL_ALLOWLIST } from "../gateway/allowlist.js";
import { guardUrl } from "../gateway/url-guard.js";
import type { FetchFn } from "../gateway/gateway.js";

/** Default hard cap on artifact size (Piper voices ~60MB, Whisper small ~0.5GB). */
const DEFAULT_MAX_BYTES = 1_500_000_000;

export interface DownloadRequest {
  readonly url: string;
  /** Lowercase hex SHA-256 committed in-repo (never fetched alongside the artifact). */
  readonly sha256: string;
  readonly fetchFn: FetchFn;
  /** Refuse a body larger than this many bytes (default ~1.5 GB). */
  readonly maxBytes?: number;
}

export async function downloadArtifact(
  req: DownloadRequest,
): Promise<Result<Uint8Array, DomainError>> {
  const guarded = guardUrl(req.url, INSTALL_ALLOWLIST);
  if (!guarded.ok) return err(guarded.error);
  const maxBytes = req.maxBytes ?? DEFAULT_MAX_BYTES;

  // Fetch the canonicalized URL the guard actually validated (not the raw input).
  const response = await req.fetchFn(guarded.value.toString(), {
    method: "GET",
    redirect: "manual",
  });
  if (response.status !== 200) {
    return err(
      domainError(
        "downloader.http-error",
        `Expected 200, got ${String(response.status)} for ${req.url}`,
      ),
    );
  }

  // Refuse an over-cap body before buffering it into memory when possible.
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return err(
      domainError(
        "downloader.too-large",
        `Artifact declares ${String(declared)} bytes > cap ${String(maxBytes)}`,
      ),
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    return err(
      domainError(
        "downloader.too-large",
        `Artifact is ${String(bytes.byteLength)} bytes > cap ${String(maxBytes)}`,
      ),
    );
  }

  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== req.sha256.toLowerCase()) {
    return err(
      domainError(
        "downloader.hash-mismatch",
        `SHA-256 mismatch for ${req.url}: expected ${req.sha256}, got ${actual}`,
      ),
    );
  }
  return ok(bytes);
}
