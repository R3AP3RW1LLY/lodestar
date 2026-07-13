import { describe, expect, it, vi } from "vitest";
import { electronIpcAdapter, registerIpcHandlers } from "./ipc.js";
import type { ElectronIpcMain, IpcMainLike } from "./ipc.js";
import type { AppHealth, RootState, WireResult } from "@lodestar/shared";
import { initialRootState } from "@lodestar/shared";

interface FakeIpcMain extends IpcMainLike {
  readonly handlers: Map<string, (...args: unknown[]) => unknown>;
}

function fakeIpcMain(): FakeIpcMain {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    handle: (channel, listener) => {
      handlers.set(channel, listener);
    },
    handlers,
  };
}

const SNAPSHOT = {
  journalPath: null,
  ollamaEndpoint: "http://127.0.0.1:11434",
  aiGpuUuid: null,
  consentWing: false,
  consentCommunity: false,
  consentDiscord: false,
  ttsEnabled: false,
  ttsVoice: "en_US-ryan-high",
  ttsVolume: 0.8,
} as const;

const PRESENCE = { inaraApiKey: false, capiTokens: false, discordWebhookUrl: false } as const;

function deps(over: Partial<Parameters<typeof registerIpcHandlers>[1]> = {}) {
  return {
    getHealth: () => ({ version: "0.1.0", dbStatus: "ok", journalStatus: "ok" }) as AppHealth,
    getSettings: () => SNAPSHOT,
    setSetting: () => ({ ok: true as const, value: SNAPSHOT }),
    autodetectJournal: () => ({ path: null }),
    getSecretsPresence: () => PRESENCE,
    setSecret: () => ({ ok: true as const, value: PRESENCE }),
    listGpus: () => Promise.resolve([]),
    subscribeState: () => initialRootState(),
    testTts: () => Promise.resolve({ ok: true as const, error: null }),
    listVoices: () => [{ id: "en_US-ryan-high", displayName: "Ryan" }],
    ...over,
  };
}

describe("registerIpcHandlers", () => {
  it("registers exactly the invoke channels through Step 2.7b", () => {
    const ipc = fakeIpcMain();
    registerIpcHandlers(ipc, deps());
    expect([...ipc.handlers.keys()].sort()).toEqual([
      "app.health",
      "journal.autodetect",
      "secrets.presence",
      "secrets.set",
      "settings.get",
      "settings.set",
      "state.snapshot",
      "system.gpus",
      "tts.test",
      "tts.voices",
    ]);
  });

  it("state.snapshot returns the current root state in a success envelope", async () => {
    const ipc = fakeIpcMain();
    const snap: RootState = { ...initialRootState(), activity: "mining" };
    const subscribeState = vi.fn(() => snap);
    registerIpcHandlers(ipc, deps({ subscribeState }));
    const result = (await ipc.handlers.get("state.snapshot")?.({})) as WireResult<RootState>;
    expect(subscribeState).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, value: snap });
  });

  it("app.health returns a success wire envelope with the health payload", async () => {
    const ipc = fakeIpcMain();
    const health: AppHealth = { version: "0.1.0", dbStatus: "ok", journalStatus: "not-configured" };
    registerIpcHandlers(ipc, deps({ getHealth: () => health }));
    const result = (await ipc.handlers.get("app.health")?.({})) as WireResult<AppHealth>;
    expect(result).toEqual({ ok: true, value: health });
  });

  it("settings.set rejects malformed args with a recoverable error envelope", async () => {
    const ipc = fakeIpcMain();
    registerIpcHandlers(ipc, deps());
    const result = (await ipc.handlers.get("settings.set")?.(null)) as WireResult<unknown>;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ipc.bad-args");
  });

  it("secrets.presence returns only booleans (never secret values)", async () => {
    const ipc = fakeIpcMain();
    registerIpcHandlers(ipc, deps());
    const result = (await ipc.handlers.get("secrets.presence")?.({})) as WireResult<
      Record<string, unknown>
    >;
    expect(result.ok).toBe(true);
    if (result.ok) {
      for (const v of Object.values(result.value)) expect(typeof v).toBe("boolean");
    }
  });

  it("settings.get returns the current snapshot in a success envelope", async () => {
    const ipc = fakeIpcMain();
    registerIpcHandlers(ipc, deps());
    const result = (await ipc.handlers.get("settings.get")?.({})) as WireResult<unknown>;
    expect(result).toEqual({ ok: true, value: SNAPSHOT });
  });

  it("settings.set forwards well-formed args to the service and returns its result", async () => {
    const ipc = fakeIpcMain();
    const setSetting = vi.fn(() => ({ ok: true as const, value: SNAPSHOT }));
    registerIpcHandlers(ipc, deps({ setSetting }));
    const result = (await ipc.handlers.get("settings.set")?.({
      key: "ollamaEndpoint",
      value: "http://127.0.0.1:1",
    })) as WireResult<unknown>;
    expect(setSetting).toHaveBeenCalledWith({ key: "ollamaEndpoint", value: "http://127.0.0.1:1" });
    expect(result.ok).toBe(true);
  });

  it("journal.autodetect returns the detected path in a success envelope", async () => {
    const ipc = fakeIpcMain();
    registerIpcHandlers(ipc, deps({ autodetectJournal: () => ({ path: "C:/journal" }) }));
    const result = (await ipc.handlers.get("journal.autodetect")?.({})) as WireResult<{
      path: string | null;
    }>;
    expect(result).toEqual({ ok: true, value: { path: "C:/journal" } });
  });

  it("secrets.set forwards well-formed args and rejects malformed ones", async () => {
    const ipc = fakeIpcMain();
    const setSecret = vi.fn(() => ({ ok: true as const, value: PRESENCE }));
    registerIpcHandlers(ipc, deps({ setSecret }));
    const ok = (await ipc.handlers.get("secrets.set")?.({
      key: "inaraApiKey",
      value: "x",
    })) as WireResult<unknown>;
    expect(setSecret).toHaveBeenCalledWith({ key: "inaraApiKey", value: "x" });
    expect(ok.ok).toBe(true);
    const bad = (await ipc.handlers.get("secrets.set")?.(42)) as WireResult<unknown>;
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.code).toBe("ipc.bad-args");
  });

  it("system.gpus awaits the async lister and wraps its list", async () => {
    const ipc = fakeIpcMain();
    const gpu = { index: 1, uuid: "GPU-x", name: "RTX 3060", memoryTotalMiB: 12288 };
    registerIpcHandlers(ipc, deps({ listGpus: () => Promise.resolve([gpu]) }));
    const result = (await ipc.handlers.get("system.gpus")?.({})) as WireResult<unknown>;
    expect(result).toEqual({ ok: true, value: [gpu] });
  });
});

describe("electronIpcAdapter", () => {
  // Electron invokes listeners as (invokeEvent, ...args). This proves the adapter
  // strips the event so an arg-taking channel receives its request as the payload
  // (the exact off-by-one that made settings.set/secrets.set fail end-to-end).
  interface CapturedElectron extends ElectronIpcMain {
    readonly listeners: Map<string, (event: unknown, ...args: unknown[]) => unknown>;
  }
  function fakeElectron(): CapturedElectron {
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    return {
      handle: (channel, listener) => {
        listeners.set(channel, listener);
      },
      listeners,
    };
  }
  const INVOKE_EVENT = { sender: {} } as const;

  it("forwards the request payload (not the invoke event) to an arg-taking channel", async () => {
    const electron = fakeElectron();
    const setSetting = vi.fn(() => ({ ok: true as const, value: SNAPSHOT }));
    registerIpcHandlers(electronIpcAdapter(electron), deps({ setSetting }));
    const req = { key: "ollamaEndpoint", value: "http://127.0.0.1:11434" };
    const result = (await electron.listeners.get("settings.set")?.(
      INVOKE_EVENT,
      req,
    )) as WireResult<unknown>;
    expect(setSetting).toHaveBeenCalledWith(req);
    expect(result.ok).toBe(true);
  });

  it("passes no payload to a no-arg channel (event stripped, nothing forwarded)", async () => {
    const electron = fakeElectron();
    const health: AppHealth = { version: "0.1.0", dbStatus: "ok", journalStatus: "ok" };
    registerIpcHandlers(electronIpcAdapter(electron), deps({ getHealth: () => health }));
    const result = (await electron.listeners.get("app.health")?.(
      INVOKE_EVENT,
    )) as WireResult<AppHealth>;
    expect(result).toEqual({ ok: true, value: health });
  });
});
