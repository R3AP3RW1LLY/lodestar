/**
 * URL guard (SSOT §5.3/§5.4). Validates a URL before any request: it must be
 * http(s), carry no userinfo, and its host must be an EXACT allowlist match —
 * or, when allowLoopback is set, a canonical literal loopback address (reusing
 * the shared loopback validator, which defeats IP-encoding and parser-
 * differential tricks). The RAW authority is checked so WHATWG normalization
 * of encoded hosts cannot smuggle a disallowed target through.
 */

import { isLoopbackUrl } from "@lodestar/shared";
import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";
import type { HostAllowlist } from "./allowlist.js";

export interface GuardOptions {
  /** Permit canonical literal loopback hosts (Ollama, sidecars, relay dev). */
  readonly allowLoopback?: boolean;
}

/** The raw host from the un-normalized authority (strips userinfo/port). */
function rawHost(raw: string): string | undefined {
  const match = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#\\]*)/.exec(raw);
  const authority = match?.[1];
  if (authority === undefined || authority.includes("@")) return undefined;
  if (authority.startsWith("[")) return authority.slice(0, authority.indexOf("]") + 1);
  return authority.split(":")[0];
}

export function guardUrl(
  raw: string,
  allowlist: HostAllowlist,
  options: GuardOptions = {},
): Result<URL, DomainError> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return err(domainError("egress.invalid-url", `Not a valid URL: ${raw}`));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return err(domainError("egress.bad-scheme", `Only http(s) is permitted, got ${url.protocol}`));
  }
  if (url.username !== "" || url.password !== "") {
    return err(domainError("egress.userinfo-forbidden", "URLs with userinfo are refused"));
  }

  if (options.allowLoopback === true && isLoopbackUrl(raw)) {
    return ok(url);
  }

  // Cross-check the raw host and the parsed host, then exact-match the allowlist.
  const parsedHost = url.hostname;
  const raw0 = rawHost(raw);
  if (raw0 === undefined || raw0 !== parsedHost) {
    return err(domainError("egress.host-mismatch", `Ambiguous or malformed host in ${raw}`));
  }
  if (!allowlist.has(parsedHost)) {
    return err(domainError("egress.host-not-allowed", `Host not on the allowlist: ${parsedHost}`));
  }
  return ok(url);
}
