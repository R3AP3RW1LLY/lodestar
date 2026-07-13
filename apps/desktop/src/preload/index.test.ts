import { describe, expect, it, vi } from "vitest";
import { EXPOSED_API_KEYS } from "./api.js";

// bridge.test.ts covers installBridge directly with doubles; this covers the
// module-level auto-install branch that runs when the real electron globals are
// present (contextBridge truthy) — the path taken inside the actual preload.
const { exposeInMainWorld, invoke, on, removeListener } = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn((): Promise<unknown> => Promise.resolve({ ok: true, value: null })),
  on: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld },
  ipcRenderer: { invoke, on, removeListener },
}));

describe("preload auto-install", () => {
  it("exposes exactly the lodestar API on the main world when contextBridge is present", async () => {
    await import("./index.js");
    expect(exposeInMainWorld).toHaveBeenCalledOnce();
    const call = exposeInMainWorld.mock.calls[0];
    expect(call?.[0]).toBe("lodestar");
    expect(Object.keys(call?.[1] as object).sort()).toEqual([...EXPOSED_API_KEYS].sort());
  });
});
