/**
 * Frontier cAPI OAuth2 + PKCE (SSOT Step 4.10). Pure PKCE primitives + the token
 * exchange/refresh calls (through the Step-4.6 ApiClient to the allowlisted
 * `auth.frontierstore.net`). The system-browser open + the loopback redirect catcher +
 * `safeStorage` token persistence are the APP's job; this module produces the authorize
 * URL, verifies nothing secret is logged, and turns an auth `code` (or a refresh token)
 * into a typed token. Randomness is injected so the PKCE derivation is testable.
 */

import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";
import type { ApiClient } from "../gateway/client.js";

export const CAPI_AUTH_ORIGIN = "https://auth.frontierstore.net";
export const CAPI_API_ORIGIN = "https://companion.orerve.net";
export const CAPI_SCOPE = "auth capi";

export interface Pkce {
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly state: string;
}

export interface CapiToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Absolute expiry (ms epoch), derived from the response's `expires_in`. */
  readonly expiresAtMs: number;
}

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

/** Generate a PKCE verifier + S256 challenge + anti-CSRF state. */
export function generatePkce(random: (size: number) => Uint8Array = nodeRandomBytes): Pkce {
  const codeVerifier = base64url(random(32));
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const state = base64url(random(16));
  return { codeVerifier, codeChallenge, state };
}

/** Build the Frontier authorize URL (S256 PKCE). `redirectUri` is the app's loopback URL. */
export function buildAuthorizeUrl(params: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
  readonly scope?: string;
}): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    state: params.state,
    code_challenge: params.codeChallenge,
    code_challenge_method: "S256",
    scope: params.scope ?? CAPI_SCOPE,
  });
  return `${CAPI_AUTH_ORIGIN}/auth?${query.toString()}`;
}

interface TokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_in: number;
}

function parseToken(body: string, nowMs: number): Result<CapiToken, DomainError> {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return err(domainError("capi/bad-json", "token response was not valid JSON"));
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    typeof (raw as TokenResponse).access_token !== "string" ||
    typeof (raw as TokenResponse).refresh_token !== "string" ||
    typeof (raw as TokenResponse).expires_in !== "number"
  ) {
    return err(domainError("capi/bad-token", "token response missing required fields"));
  }
  const token = raw as TokenResponse;
  return ok({
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAtMs: nowMs + token.expires_in * 1000,
  });
}

async function postToken(
  api: ApiClient,
  form: Record<string, string>,
  nowMs: number,
): Promise<Result<CapiToken, DomainError>> {
  const result = await api.request({
    url: `${CAPI_AUTH_ORIGIN}/token`,
    ttlMs: 0,
    init: {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    },
  });
  if (!result.ok) return err(result.error);
  return parseToken(result.value.body, nowMs);
}

/** Exchange an authorization `code` (+ PKCE verifier) for a token. */
export function exchangeCodeForToken(
  api: ApiClient,
  params: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly code: string;
    readonly codeVerifier: string;
  },
  nowMs: number,
): Promise<Result<CapiToken, DomainError>> {
  return postToken(
    api,
    {
      grant_type: "authorization_code",
      client_id: params.clientId,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
    },
    nowMs,
  );
}

/** Refresh an access token using a stored refresh token. */
export function refreshAccessToken(
  api: ApiClient,
  params: { readonly clientId: string; readonly refreshToken: string },
  nowMs: number,
): Promise<Result<CapiToken, DomainError>> {
  return postToken(
    api,
    {
      grant_type: "refresh_token",
      client_id: params.clientId,
      refresh_token: params.refreshToken,
    },
    nowMs,
  );
}

/** True if the token is expired (or within `skewMs` of expiring). */
export function isTokenExpired(token: CapiToken, nowMs: number, skewMs = 60_000): boolean {
  return token.expiresAtMs - skewMs <= nowMs;
}
