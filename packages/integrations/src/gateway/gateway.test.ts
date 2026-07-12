import { describe, expect, it, vi } from "vitest";
import { createGateway } from "./gateway.js";

function response(status: number, headers: Record<string, string> = {}, body = ""): Response {
  return new Response(body, { status, headers });
}

describe("gateway", () => {
  it("fetches an allowlisted URL through the injected transport", async () => {
    const fetchFn = vi.fn().mockResolvedValue(response(200, {}, "ok"));
    const gw = createGateway({ fetchFn });
    const r = await gw.request("https://www.edsm.net/api/x");
    expect(r.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledOnce();
    // Redirects are handled manually.
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("refuses a non-allowlisted URL WITHOUT calling the transport", async () => {
    const fetchFn = vi.fn();
    const gw = createGateway({ fetchFn });
    const r = await gw.request("https://api.anthropic.com/v1/messages");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("egress.host-not-allowed");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("follows an allowlisted redirect and re-checks each hop", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: "https://spansh.co.uk/next" }))
      .mockResolvedValueOnce(response(200, {}, "final"));
    const gw = createGateway({ fetchFn });
    const r = await gw.request("https://www.edsm.net/start");
    expect(r.ok).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1]?.[0]).toBe("https://spansh.co.uk/next");
  });

  it("REFUSES a redirect that escapes to a non-allowlisted host (SSRF via 302)", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: "https://api.openai.com/v1/chat" }));
    const gw = createGateway({ fetchFn });
    const r = await gw.request("https://www.edsm.net/start");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("egress.redirect-not-allowed");
    // The escaping hop was never fetched.
    expect(fetchFn).toHaveBeenCalledOnce();
  });

  it("refuses after exceeding the max redirect hops", async () => {
    // Always redirect to another allowlisted host — should stop at the cap.
    const fetchFn = vi
      .fn()
      .mockResolvedValue(response(302, { location: "https://spansh.co.uk/loop" }));
    const gw = createGateway({ fetchFn, maxRedirects: 3 });
    const r = await gw.request("https://www.edsm.net/start");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("egress.too-many-redirects");
    expect(fetchFn.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("refuses a redirect with no Location header rather than looping", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(response(302, {}));
    const gw = createGateway({ fetchFn });
    const r = await gw.request("https://www.edsm.net/start");
    expect(r.ok).toBe(false);
  });

  it("strips credential headers when a redirect crosses to a different host", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: "https://discord.com/next" }))
      .mockResolvedValueOnce(response(200, {}, "ok"));
    const gw = createGateway({ fetchFn });
    await gw.request("https://www.edsm.net/start", {
      headers: { Authorization: "Bearer edsm-secret", "X-Api-Key": "k", "X-Keep": "v" },
    });
    const secondInit = fetchFn.mock.calls[1]?.[1] as RequestInit;
    const headers = new Headers(secondInit.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-key")).toBeNull();
    // Non-sensitive headers are preserved.
    expect(headers.get("x-keep")).toBe("v");
  });

  it("preserves credential headers on a SAME-host redirect", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: "https://www.edsm.net/next" }))
      .mockResolvedValueOnce(response(200, {}, "ok"));
    const gw = createGateway({ fetchFn });
    await gw.request("https://www.edsm.net/start", {
      headers: { Authorization: "Bearer edsm-secret" },
    });
    const headers = new Headers((fetchFn.mock.calls[1]?.[1] as RequestInit).headers);
    expect(headers.get("authorization")).toBe("Bearer edsm-secret");
  });
});
