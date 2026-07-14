/**
 * Frontier cAPI client (SSOT Step 4.10, feature-flagged). Fetches `/profile` + `/market`
 * from `companion.orerve.net` with a Bearer token, refreshing it (via the refresh token)
 * when it's expired. **Flag-off → no network attempt at all.** Tokens live ONLY in the
 * injected `CapiTokenStore` (the app backs it with `safeStorage`); this client never logs
 * or plaintext-persists them. cAPI data is live per §5.3 (`ttlMs:0`, no cache beyond
 * session). Ships disabled until Frontier client-id approval (§9).
 */

import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";
import type { ApiClient } from "../gateway/client.js";
import type { CapiToken } from "./oauth.js";
import { CAPI_API_ORIGIN, isTokenExpired, refreshAccessToken } from "./oauth.js";

export interface CapiTokenStore {
  get: () => CapiToken | undefined;
  set: (token: CapiToken) => void;
  clear: () => void;
}

export interface CapiConfig {
  readonly clientId: string;
  /** The Settings feature flag; false until Frontier approval + user opt-in. */
  readonly enabled: boolean;
}

export interface CapiDeps {
  readonly api: ApiClient;
  readonly tokenStore: CapiTokenStore;
  readonly config: CapiConfig;
  readonly now: () => number;
}

export interface CapiClient {
  isEnabled: () => boolean;
  profile: () => Promise<Result<unknown, DomainError>>;
  market: () => Promise<Result<unknown, DomainError>>;
}

export function createCapiClient(deps: CapiDeps): CapiClient {
  async function authedGet(path: string): Promise<Result<unknown, DomainError>> {
    if (!deps.config.enabled) {
      return err(domainError("capi/disabled", "Frontier cAPI is disabled"));
    }
    let token = deps.tokenStore.get();
    if (token === undefined) {
      return err(domainError("capi/no-token", "not linked to Frontier — authorize first"));
    }
    if (isTokenExpired(token, deps.now())) {
      const refreshed = await refreshAccessToken(
        deps.api,
        { clientId: deps.config.clientId, refreshToken: token.refreshToken },
        deps.now(),
      );
      if (!refreshed.ok) return err(refreshed.error);
      deps.tokenStore.set(refreshed.value);
      token = refreshed.value;
    }
    const result = await deps.api.request({
      url: `${CAPI_API_ORIGIN}${path}`,
      ttlMs: 0, // live, no cache beyond session (§5.3)
      init: { headers: { authorization: `Bearer ${token.accessToken}` } },
    });
    if (!result.ok) return err(result.error);
    try {
      return ok(JSON.parse(result.value.body));
    } catch {
      return err(domainError("capi/bad-json", "cAPI response was not valid JSON"));
    }
  }

  return {
    isEnabled: () => deps.config.enabled,
    profile: () => authedGet("/profile"),
    market: () => authedGet("/market"),
  };
}
