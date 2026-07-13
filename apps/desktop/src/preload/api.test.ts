import { describe, expect, it, vi } from "vitest";
import { createLodestarApi, EXPOSED_API_KEYS } from "./api.js";

describe("preload API surface", () => {
  it("exposes only the whitelisted, typed methods — no raw ipcRenderer", () => {
    const api = createLodestarApi({ invoke: vi.fn() });
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
    const api = createLodestarApi({ invoke });
    const health = await api.getHealth();
    expect(invoke).toHaveBeenCalledWith("app.health");
    expect(health.version).toBe("0.1.0");
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
    const api = createLodestarApi({ invoke });
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
    const api = createLodestarApi({ invoke });

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
});
