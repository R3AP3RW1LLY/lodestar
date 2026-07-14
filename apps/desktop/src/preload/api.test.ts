import { describe, expect, it, vi } from "vitest";
import { envelope } from "@lodestar/shared";
import { createLodestarApi, EXPOSED_API_KEYS } from "./api.js";
import type { IpcInvoker } from "./api.js";

/** A push port that records subscriptions and lets a test emit to a channel. */
function fakePush() {
  const listeners = new Map<string, Set<(m: unknown) => void>>();
  const on: IpcInvoker["on"] = (channel, listener) => {
    const set = listeners.get(channel) ?? new Set();
    set.add(listener);
    listeners.set(channel, set);
    return () => set.delete(listener);
  };
  const emit = (channel: string, message: unknown): void => {
    for (const l of listeners.get(channel) ?? []) l(message);
  };
  return { on, emit };
}

describe("preload API surface", () => {
  it("exposes only the whitelisted, typed methods — no raw ipcRenderer", () => {
    const api = createLodestarApi({ invoke: vi.fn(), on: vi.fn(() => () => {}) });
    expect(Object.keys(api).sort()).toEqual([...EXPOSED_API_KEYS].sort());
    for (const value of Object.values(api)) {
      expect(typeof value).toBe("function");
    }
    // The raw transport must never be reachable from the exposed surface.
    const asRecord = api as unknown as Record<string, unknown>;
    expect(asRecord["ipcRenderer"]).toBeUndefined();
    expect(asRecord["invoke"]).toBeUndefined();
  });

  it("getHealth invokes the app.health channel and unwraps the success envelope", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      value: { version: "0.1.0", dbStatus: "ok", journalStatus: "not-configured" },
    });
    const api = createLodestarApi({ invoke, on: vi.fn(() => () => {}) });
    const health = await api.getHealth();
    expect(invoke).toHaveBeenCalledWith("app.health");
    expect(health.version).toBe("0.1.0");
  });

  it("getStateSnapshot invokes state.snapshot and unwraps the root state", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, value: { activity: "mining" } });
    const api = createLodestarApi({ invoke, on: vi.fn(() => () => {}) });
    expect(await api.getStateSnapshot()).toEqual({ activity: "mining" });
    expect(invoke).toHaveBeenCalledWith("state.snapshot");
  });

  it("onStateDelta delivers only valid state.delta envelope payloads and unsubscribes", () => {
    const push = fakePush();
    const api = createLodestarApi({ invoke: vi.fn(), on: push.on });
    const seen: unknown[] = [];
    const off = api.onStateDelta((d) => seen.push(d));

    push.emit("state.delta", envelope("state.delta", { activity: "mining" }));
    push.emit("state.delta", { not: "an envelope" }); // dropped
    push.emit("state.delta", envelope("session.stats", null)); // wrong channel → dropped
    push.emit("state.delta", { v: 1, ts: "t", channel: "state.delta", payload: 42 }); // non-object payload → dropped
    expect(seen).toEqual([{ activity: "mining" }]);

    off();
    push.emit("state.delta", envelope("state.delta", { activity: "docked" }));
    expect(seen).toEqual([{ activity: "mining" }]); // no further delivery
  });

  it("onSessionStats delivers session.stats payloads (including null)", () => {
    const push = fakePush();
    const api = createLodestarApi({ invoke: vi.fn(), on: push.on });
    const seen: unknown[] = [];
    api.onSessionStats((s) => seen.push(s));
    push.emit("session.stats", envelope("session.stats", null));
    expect(seen).toEqual([null]);
  });

  it("getHealth throws a typed error when the main process returns an error envelope", async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "health.failed",
        message: "probe failed",
        causeChain: ["health.failed: probe failed"],
      },
    });
    const api = createLodestarApi({ invoke, on: vi.fn(() => () => {}) });
    await expect(api.getHealth()).rejects.toThrow("probe failed");
  });

  it("routes every method to its channel, forwards args, and unwraps the value", async () => {
    const invoke = vi.fn().mockImplementation((channel: string) => {
      const value: Record<string, unknown> = {
        "settings.get": { journalPath: null },
        "settings.set": { journalPath: "C:/j" },
        "journal.autodetect": { path: "C:/j" },
        "secrets.presence": { inaraApiKey: false },
        "secrets.set": { inaraApiKey: true },
        "system.gpus": [{ index: 1, uuid: "GPU-x", name: "RTX 3060", memoryTotalMiB: 12288 }],
      };
      return Promise.resolve({ ok: true, value: value[channel] });
    });
    const api = createLodestarApi({ invoke, on: vi.fn(() => () => {}) });

    expect(await api.getSettings()).toEqual({ journalPath: null });
    expect(invoke).toHaveBeenCalledWith("settings.get");

    await api.setSetting({ key: "journalPath", value: "C:/j" });
    expect(invoke).toHaveBeenCalledWith("settings.set", { key: "journalPath", value: "C:/j" });

    expect(await api.autodetectJournal()).toEqual({ path: "C:/j" });
    expect(invoke).toHaveBeenCalledWith("journal.autodetect");

    expect(await api.getSecretsPresence()).toEqual({ inaraApiKey: false });
    expect(invoke).toHaveBeenCalledWith("secrets.presence");

    await api.setSecret({ key: "inaraApiKey", value: "x" });
    expect(invoke).toHaveBeenCalledWith("secrets.set", { key: "inaraApiKey", value: "x" });

    expect(await api.listGpus()).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("system.gpus");
  });

  it("getManifest + getSessionDetail route to their analytics channels", async () => {
    const invoke = vi.fn().mockResolvedValue({ ok: true, value: null });
    const api = createLodestarApi({ invoke, on: vi.fn(() => () => {}) });
    await api.getManifest({ system: "Paesia" });
    expect(invoke).toHaveBeenCalledWith("analytics.manifest", { system: "Paesia" });
    await api.getSessionDetail(7);
    expect(invoke).toHaveBeenCalledWith("analytics.sessionDetail", { sessionId: 7 });
  });
});
