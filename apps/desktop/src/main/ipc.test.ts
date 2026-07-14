import { describe, expect, it, vi } from "vitest";
import { electronIpcAdapter, registerIpcHandlers } from "./ipc.js";
import type { ElectronIpcMain, IpcMainLike } from "./ipc.js";
import type { AppHealth, ManifestData, RootState, WireResult } from "@lodestar/shared";
import { initialRootState } from "@lodestar/shared";

const EMPTY_MANIFEST: ManifestData = {
  sessions: [],
  aggregate: {
    sessions: 0,
    tonsRefined: 0,
    creditsEarned: 0,
    limpetsLaunched: 0,
    totalDurationSec: 0,
    avgTonsPerHour: 0,
    avgCreditsPerHour: 0,
    prospected: 0,
    mineVerdicts: 0,
    hitRate: 0,
  },
  breakdowns: { byCommodity: [], byRing: [], byShip: [], bestPairings: [] },
  heatmaps: {
    timeProductivity: { rows: [], cols: [], cells: [] },
    ringCommodityYield: { rows: [], cols: [], cells: [] },
  },
  trend: [],
  efficiency: {
    limpets: {
      perSession: [],
      totals: {
        sessions: 0,
        prospectorLimpets: 0,
        collectionLimpets: 0,
        tonsRefined: 0,
        collectorProductivity: 0,
      },
    },
    timeSplit: {
      perSession: [],
      totals: { sessions: 0, durationSec: 0, miningSec: 0, otherSec: 0, miningRatio: 0 },
    },
  },
  personalBests: [],
};

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
    toggleOverlay: () => ({ visible: true }),
    lockOverlay: () => ({ locked: true }),
    exportAnalytics: () => Promise.resolve({ ok: true as const, path: null }),
    getManifest: () => EMPTY_MANIFEST,
    getSessionDetail: () => null,
    ledgerBoard: () => [],
    ledgerStations: () => [],
    ledgerTrend: () => [],
    listAlerts: () => [],
    addAlert: () => [],
    setAlertEnabled: () => [],
    deleteAlert: () => [],
    planRuns: () => Promise.resolve([]),
    savePlan: () => ({ runId: null }),
    ...over,
  };
}

describe("registerIpcHandlers", () => {
  it("registers exactly the invoke channels through Step 4.11c", () => {
    const ipc = fakeIpcMain();
    registerIpcHandlers(ipc, deps());
    expect([...ipc.handlers.keys()].sort()).toEqual([
      "alerts.add",
      "alerts.delete",
      "alerts.list",
      "alerts.setEnabled",
      "analytics.export",
      "analytics.manifest",
      "analytics.sessionDetail",
      "app.health",
      "journal.autodetect",
      "ledger.board",
      "ledger.stations",
      "ledger.trend",
      "overlay.lock",
      "overlay.toggle",
      "planner.plan",
      "planner.save",
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

  it("overlay.toggle returns the new overlay visibility in a success envelope", async () => {
    const ipc = fakeIpcMain();
    registerIpcHandlers(ipc, deps({ toggleOverlay: () => ({ visible: false }) }));
    const result = (await ipc.handlers.get("overlay.toggle")?.({})) as WireResult<{
      visible: boolean;
    }>;
    expect(result).toEqual({ ok: true, value: { visible: false } });
  });

  it("overlay.lock returns the new overlay mode in a success envelope", async () => {
    const ipc = fakeIpcMain();
    registerIpcHandlers(ipc, deps({ lockOverlay: () => ({ locked: false }) }));
    const result = (await ipc.handlers.get("overlay.lock")?.({})) as WireResult<{
      locked: boolean;
    }>;
    expect(result).toEqual({ ok: true, value: { locked: false } });
  });

  it("analytics.manifest forwards the filter (or {} for a non-object) and returns the bundle", async () => {
    const ipc = fakeIpcMain();
    const getManifest = vi.fn(() => EMPTY_MANIFEST);
    registerIpcHandlers(ipc, deps({ getManifest }));
    const r = (await ipc.handlers.get("analytics.manifest")?.({ system: "Paesia" })) as WireResult<
      typeof EMPTY_MANIFEST
    >;
    expect(getManifest).toHaveBeenCalledWith({ system: "Paesia" });
    expect(r.ok).toBe(true);
    await ipc.handlers.get("analytics.manifest")?.(undefined); // non-object → {}
    expect(getManifest).toHaveBeenLastCalledWith({});
  });

  it("analytics.sessionDetail validates the id and forwards it", async () => {
    const ipc = fakeIpcMain();
    const getSessionDetail = vi.fn(() => null);
    registerIpcHandlers(ipc, deps({ getSessionDetail }));
    const good = (await ipc.handlers.get("analytics.sessionDetail")?.({
      sessionId: 5,
    })) as WireResult<unknown>;
    expect(getSessionDetail).toHaveBeenCalledWith(5);
    expect(good).toEqual({ ok: true, value: null });
    const bad = (await ipc.handlers.get("analytics.sessionDetail")?.({})) as WireResult<unknown>;
    expect(bad.ok).toBe(false);
  });

  it("analytics.export forwards a valid request and rejects an unknown kind", async () => {
    const ipc = fakeIpcMain();
    const exportAnalytics = vi.fn(() => Promise.resolve({ ok: true as const, path: "D:/x.csv" }));
    registerIpcHandlers(ipc, deps({ exportAnalytics }));
    const good = (await ipc.handlers.get("analytics.export")?.({
      kind: "sessions",
      bom: true,
    })) as WireResult<{ ok: boolean; path: string | null }>;
    expect(exportAnalytics).toHaveBeenCalledWith({ kind: "sessions", bom: true });
    expect(good).toEqual({ ok: true, value: { ok: true, path: "D:/x.csv" } });
    const bad = (await ipc.handlers.get("analytics.export")?.({
      kind: "nope",
    })) as WireResult<unknown>;
    expect(bad.ok).toBe(false);
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

  it("ledger.board wraps the board list", async () => {
    const ipc = fakeIpcMain();
    const entry = { commodityId: "painite", best: null };
    registerIpcHandlers(ipc, deps({ ledgerBoard: () => [entry] }));
    const r = (await ipc.handlers.get("ledger.board")?.({})) as WireResult<unknown>;
    expect(r).toEqual({ ok: true, value: [entry] });
  });

  it("ledger.stations forwards a valid query and rejects a missing commodityId", async () => {
    const ipc = fakeIpcMain();
    const ledgerStations = vi.fn(() => []);
    registerIpcHandlers(ipc, deps({ ledgerStations }));
    const good = (await ipc.handlers.get("ledger.stations")?.({
      commodityId: "painite",
      minPad: "L",
    })) as WireResult<unknown>;
    expect(ledgerStations).toHaveBeenCalledWith({ commodityId: "painite", minPad: "L" });
    expect(good.ok).toBe(true);
    const bad = (await ipc.handlers.get("ledger.stations")?.({})) as WireResult<unknown>;
    expect(bad.ok).toBe(false);
  });

  it("ledger.trend requires commodityId + bucketMs", async () => {
    const ipc = fakeIpcMain();
    const ledgerTrend = vi.fn(() => []);
    registerIpcHandlers(ipc, deps({ ledgerTrend }));
    const good = (await ipc.handlers.get("ledger.trend")?.({
      commodityId: "painite",
      bucketMs: 1000,
    })) as WireResult<unknown>;
    expect(good.ok).toBe(true);
    const bad = (await ipc.handlers.get("ledger.trend")?.({
      commodityId: "painite",
    })) as WireResult<unknown>;
    expect(bad.ok).toBe(false);
  });

  it("alerts.* forward valid requests and reject malformed ones", async () => {
    const ipc = fakeIpcMain();
    const addAlert = vi.fn(() => []);
    const setAlertEnabled = vi.fn(() => []);
    const deleteAlert = vi.fn(() => []);
    registerIpcHandlers(ipc, deps({ addAlert, setAlertEnabled, deleteAlert }));

    expect(((await ipc.handlers.get("alerts.list")?.({})) as WireResult<unknown>).ok).toBe(true);

    const add = (await ipc.handlers.get("alerts.add")?.({
      kind: "cargo-full",
      threshold: 80,
    })) as WireResult<unknown>;
    expect(addAlert).toHaveBeenCalledWith({ kind: "cargo-full", threshold: 80 });
    expect(add.ok).toBe(true);
    expect(
      ((await ipc.handlers.get("alerts.add")?.({ kind: "bogus" })) as WireResult<unknown>).ok,
    ).toBe(false);

    await ipc.handlers.get("alerts.setEnabled")?.({ id: 3, enabled: false });
    expect(setAlertEnabled).toHaveBeenCalledWith(3, false);
    expect(
      ((await ipc.handlers.get("alerts.setEnabled")?.({ id: 3 })) as WireResult<unknown>).ok,
    ).toBe(false);

    await ipc.handlers.get("alerts.delete")?.({ id: 9 });
    expect(deleteAlert).toHaveBeenCalledWith(9);
    expect(((await ipc.handlers.get("alerts.delete")?.({})) as WireResult<unknown>).ok).toBe(false);
  });

  it("planner.plan validates the strategy and returns ranked plans", async () => {
    const ipc = fakeIpcMain();
    const planRuns = vi.fn(() => Promise.resolve([]));
    registerIpcHandlers(ipc, deps({ planRuns }));
    const good = (await ipc.handlers.get("planner.plan")?.({
      strategy: "max-profit",
    })) as WireResult<unknown>;
    expect(planRuns).toHaveBeenCalledWith("max-profit");
    expect(good.ok).toBe(true);
    const bad = (await ipc.handlers.get("planner.plan")?.({
      strategy: "bogus",
    })) as WireResult<unknown>;
    expect(bad.ok).toBe(false);
  });

  it("planner.save validates the index and forwards it", async () => {
    const ipc = fakeIpcMain();
    const savePlan = vi.fn(() => ({ runId: 7 }));
    registerIpcHandlers(ipc, deps({ savePlan }));
    const good = (await ipc.handlers.get("planner.save")?.({ index: 0 })) as WireResult<unknown>;
    expect(savePlan).toHaveBeenCalledWith(0);
    expect(good).toEqual({ ok: true, value: { runId: 7 } });
    expect(((await ipc.handlers.get("planner.save")?.({})) as WireResult<unknown>).ok).toBe(false);
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
