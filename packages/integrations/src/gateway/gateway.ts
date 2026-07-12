/**
 * The single egress gateway (SSOT §5.3/§5.4). Every runtime HTTP request goes
 * through here: the target and EVERY redirect hop are allowlist-checked before
 * a socket is opened, redirects are followed manually (max hops), and a
 * non-allowlisted redirect target is refused rather than followed. The fetch
 * transport is injected so this is fully testable offline. Caching and rate
 * limiting are layered on in Step 4.6.
 */

import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";
import { RUNTIME_ALLOWLIST } from "./allowlist.js";
import type { HostAllowlist } from "./allowlist.js";
import { guardUrl } from "./url-guard.js";

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface GatewayOptions {
  readonly fetchFn: FetchFn;
  readonly allowlist?: HostAllowlist;
  readonly maxRedirects?: number;
  readonly allowLoopback?: boolean;
}

// Credential-bearing headers are stripped when a redirect crosses to a
// different host, so an open-redirect on one allowlisted host cannot siphon
// another host's auth to a third party (browser cross-origin behavior).
const SENSITIVE_HEADERS = ["authorization", "cookie", "proxy-authorization", "x-api-key"];

function stripSensitiveHeaders(init: RequestInit): RequestInit {
  const headers = new Headers(init.headers);
  for (const name of SENSITIVE_HEADERS) headers.delete(name);
  return { ...init, headers };
}

export interface Gateway {
  request: (rawUrl: string, init?: RequestInit) => Promise<Result<Response, DomainError>>;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function createGateway(options: GatewayOptions): Gateway {
  const allowlist = options.allowlist ?? RUNTIME_ALLOWLIST;
  const maxRedirects = options.maxRedirects ?? 3;
  const guardOpts = { allowLoopback: options.allowLoopback ?? false };

  return {
    async request(rawUrl: string, init: RequestInit = {}): Promise<Result<Response, DomainError>> {
      const initial = guardUrl(rawUrl, allowlist, guardOpts);
      if (!initial.ok) return err(initial.error);

      let currentUrl = initial.value.toString();
      let currentHost = initial.value.host;
      let currentInit: RequestInit = init;
      for (let hop = 0; hop <= maxRedirects; hop++) {
        const response = await options.fetchFn(currentUrl, { ...currentInit, redirect: "manual" });
        if (!REDIRECT_STATUSES.has(response.status)) {
          return ok(response);
        }
        const location = response.headers.get("location");
        if (location === null || location === "") {
          return err(domainError("egress.bad-redirect", "Redirect response had no Location"));
        }
        if (hop === maxRedirects) {
          return err(
            domainError("egress.too-many-redirects", `Exceeded ${String(maxRedirects)} redirects`),
          );
        }
        // Resolve relative redirects, then re-check the target against the allowlist.
        const next = new URL(location, currentUrl).toString();
        const guarded = guardUrl(next, allowlist, guardOpts);
        if (!guarded.ok) {
          return err(
            domainError(
              "egress.redirect-not-allowed",
              `Refused redirect to a non-allowlisted host: ${next}`,
              guarded.error,
            ),
          );
        }
        // Strip credential headers when the host changes across the redirect.
        if (guarded.value.host !== currentHost) {
          currentInit = stripSensitiveHeaders(currentInit);
        }
        currentUrl = guarded.value.toString();
        currentHost = guarded.value.host;
      }
      // Unreachable — the loop returns on the final hop.
      return err(domainError("egress.too-many-redirects", "redirect loop"));
    },
  };
}
