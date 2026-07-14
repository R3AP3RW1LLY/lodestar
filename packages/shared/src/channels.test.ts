import { describe, expect, it } from "vitest";
import { CHANNELS, envelope, isEnvelope } from "./channels.js";
import type { AppHealth, Envelope } from "./channels.js";

describe("IPC channels", () => {
  it("the channel union is closed and contains exactly the registered channels", () => {
    expect([...CHANNELS].sort()).toEqual([
      "analytics.export",
      "analytics.manifest",
      "analytics.sessionDetail",
      "app.health",
      "assay.verdict",
      "journal.autodetect",
      "overlay.lock",
      "overlay.mode",
      "overlay.toggle",
      "secrets.presence",
      "secrets.set",
      "session.stats",
      "settings.get",
      "settings.set",
      "state.delta",
      "state.snapshot",
      "system.gpus",
      "tts.audio",
      "tts.test",
      "tts.voices",
    ]);
  });

  it("envelope stamps v:1, an ISO-8601 ts, the channel, and the payload", () => {
    const payload: AppHealth = {
      version: "0.1.0",
      dbStatus: "not-configured",
      journalStatus: "not-configured",
    };
    const e = envelope("app.health", payload);
    expect(e.v).toBe(1);
    expect(e.channel).toBe("app.health");
    expect(e.payload).toEqual(payload);
    expect(Number.isNaN(Date.parse(e.ts))).toBe(false);
  });

  it("envelope accepts an injected clock for deterministic tests", () => {
    const fixed = new Date("2026-07-12T12:00:00.000Z");
    const e = envelope(
      "app.health",
      { version: "x", dbStatus: "error", journalStatus: "ok" },
      () => fixed,
    );
    expect(e.ts).toBe("2026-07-12T12:00:00.000Z");
  });

  it("isEnvelope validates OUTER SHAPE ONLY — a garbage payload on a valid channel passes (documented contract; payload validation is per-channel at the consumer)", () => {
    expect(isEnvelope({ v: 1, ts: "t", channel: "app.health", payload: "garbage" })).toBe(true);
    expect(isEnvelope({ v: 1, ts: "t", channel: "app.health", payload: null })).toBe(true);
  });

  it("isEnvelope requires payload as an OWN property (prototype-inherited rejected)", () => {
    const inherited = Object.create({ payload: {} }) as Record<string, unknown>;
    inherited["v"] = 1;
    inherited["ts"] = "t";
    inherited["channel"] = "app.health";
    expect(isEnvelope(inherited)).toBe(false);
  });

  it("narrowing on .channel narrows .payload (discriminated union, compile-time)", () => {
    // Widen to the full union via a function boundary so the narrowing below is
    // genuine (not statically known to be a single channel).
    const widen = (x: Envelope): Envelope => x;
    const e = widen(
      envelope("app.health", { version: "0.1.0", dbStatus: "ok", journalStatus: "ok" }),
    );
    if (e.channel === "app.health") {
      // This line type-checks ONLY if narrowing works — dbStatus is a closed union.
      const s: "not-configured" | "ok" | "error" = e.payload.dbStatus;
      expect(s).toBe("ok");
    }
  });

  it("isEnvelope accepts well-formed envelopes and rejects malformed ones", () => {
    const good: Envelope = envelope("app.health", {
      version: "0.1.0",
      dbStatus: "ok",
      journalStatus: "ok",
    });
    expect(isEnvelope(good)).toBe(true);
    for (const bad of [
      null,
      undefined,
      42,
      "str",
      {},
      { v: 2, ts: "t", channel: "app.health", payload: {} },
      { v: 1, ts: 5, channel: "app.health", payload: {} },
      { v: 1, ts: "t", channel: "not.a.channel", payload: {} },
      { v: 1, ts: "t", channel: "app.health" },
    ]) {
      expect(isEnvelope(bad)).toBe(false);
    }
  });
});
