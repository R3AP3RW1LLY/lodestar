import { describe, expect, it, vi } from "vitest";
import { installBridge } from "./index.js";
import { EXPOSED_API_KEYS } from "./api.js";

describe("installBridge", () => {
  it("exposes exactly one world key, 'lodestar', and nothing else (no raw ipcRenderer)", () => {
    const exposeInMainWorld = vi.fn();
    installBridge({ exposeInMainWorld }, { invoke: vi.fn() });
    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    const call = exposeInMainWorld.mock.calls[0];
    expect(call?.[0]).toBe("lodestar");
    expect(Object.keys(call?.[1] as object).sort()).toEqual([...EXPOSED_API_KEYS].sort());
  });

  it("wires the exposed API to the underlying invoker channel", async () => {
    let capturedApi: { getHealth: () => Promise<unknown> } | undefined;
    const exposeInMainWorld = vi.fn((_key: string, api: unknown) => {
      capturedApi = api as { getHealth: () => Promise<unknown> };
    });
    const invoke = vi.fn().mockResolvedValue({
      ok: true,
      value: { version: "0.1.0", dbStatus: "ok", journalStatus: "ok" },
    });
    installBridge({ exposeInMainWorld }, { invoke });
    await capturedApi?.getHealth();
    expect(invoke).toHaveBeenCalledWith("app.health");
  });
});
