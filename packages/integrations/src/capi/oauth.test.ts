import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../gateway/client.js";
import type { FetchFn } from "../gateway/gateway.js";
import { createGateway } from "../gateway/gateway.js";
import { createMemoryCacheStore } from "../gateway/cache.js";
import { createRateLimiter } from "../gateway/rate-limiter.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  generatePkce,
  isTokenExpired,
  refreshAccessToken,
} from "./oauth.js";

const apiOver = (fetchFn: FetchFn) =>
  createApiClient({
    gateway: createGateway({ fetchFn }),
    rateLimiter: createRateLimiter(),
    cache: createMemoryCacheStore(),
    now: () => 0,
    sleep: async () => {
      await Promise.resolve();
    },
    rand: () => 0,
  });

const tokenResponse = (over: Record<string, unknown> = {}): Response =>
  new Response(
    JSON.stringify({
      access_token: "access-fixture",
      refresh_token: "refresh-fixture",
      expires_in: 3600,
      ...over,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("generatePkce", () => {
  it("derives an S256 challenge from the verifier + a distinct state", () => {
    const fixed = (size: number) => Buffer.alloc(size, 1);
    const pkce = generatePkce(fixed);
    const expectedChallenge = createHash("sha256").update(pkce.codeVerifier).digest("base64url");
    expect(pkce.codeChallenge).toBe(expectedChallenge);
    expect(pkce.state.length).toBeGreaterThan(0);
    expect(pkce.codeVerifier).not.toBe(pkce.codeChallenge);
  });

  it("uses real randomness by default (two calls differ)", () => {
    expect(generatePkce().codeVerifier).not.toBe(generatePkce().codeVerifier);
  });
});

describe("buildAuthorizeUrl", () => {
  it("targets auth.frontierstore.net with S256 PKCE + state + scope", () => {
    const url = buildAuthorizeUrl({
      clientId: "client-abc",
      redirectUri: "http://127.0.0.1:52001/callback",
      state: "state-xyz",
      codeChallenge: "challenge-123",
    });
    expect(url).toContain("https://auth.frontierstore.net/auth?");
    expect(url).toContain("response_type=code");
    expect(url).toContain("client_id=client-abc");
    expect(url).toContain("code_challenge=challenge-123");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("state=state-xyz");
    expect(url).toContain("scope=auth+capi");
    expect(url).toContain("redirect_uri=http%3A%2F%2F127.0.0.1%3A52001%2Fcallback");
  });
});

describe("exchangeCodeForToken", () => {
  it("POSTs the code + verifier and computes an absolute expiry", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse());
    const token = await exchangeCodeForToken(
      apiOver(fetchFn),
      {
        clientId: "c",
        redirectUri: "http://127.0.0.1:1/cb",
        code: "the-code",
        codeVerifier: "the-verifier",
      },
      1000,
    );
    expect(token.ok).toBe(true);
    if (token.ok)
      expect(token.value).toMatchObject({
        accessToken: "access-fixture",
        refreshToken: "refresh-fixture",
        expiresAtMs: 1000 + 3600 * 1000,
      });
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://auth.frontierstore.net/token");
    const form = new URLSearchParams(init.body as string);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("the-code");
    expect(form.get("code_verifier")).toBe("the-verifier");
  });

  it("rejects a malformed token response", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const token = await exchangeCodeForToken(
      apiOver(fetchFn),
      { clientId: "c", redirectUri: "r", code: "x", codeVerifier: "y" },
      0,
    );
    expect(token.ok).toBe(false);
    if (!token.ok) expect(token.error.code).toBe("capi/bad-token");
  });
});

describe("refreshAccessToken", () => {
  it("POSTs grant_type=refresh_token", async () => {
    const fetchFn = vi.fn().mockResolvedValue(tokenResponse({ access_token: "fresh" }));
    const token = await refreshAccessToken(
      apiOver(fetchFn),
      { clientId: "c", refreshToken: "r" },
      0,
    );
    expect(token.ok && token.value.accessToken).toBe("fresh");
    const form = new URLSearchParams((fetchFn.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("r");
  });
});

describe("isTokenExpired", () => {
  const token = { accessToken: "a", refreshToken: "r", expiresAtMs: 100_000 };
  it("is false well before expiry", () => {
    expect(isTokenExpired(token, 0)).toBe(false);
  });
  it("is true past expiry", () => {
    expect(isTokenExpired(token, 200_000)).toBe(true);
  });
  it("is true within the refresh skew window", () => {
    expect(isTokenExpired(token, 100_000 - 30_000, 60_000)).toBe(true);
  });
});
