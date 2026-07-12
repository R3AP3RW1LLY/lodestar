import { describe, expect, it } from "vitest";
import { registerIpcHandlers } from "./ipc.js";
import type { IpcMainLike } from "./ipc.js";
import type { AppHealth, WireResult } from "@lodestar/shared";

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

describe("registerIpcHandlers", () => {
  it("registers exactly the app.health channel", () => {
    const ipc = fakeIpcMain();
    registerIpcHandlers(ipc, {
      getHealth: () => ({ version: "0.1.0", dbStatus: "ok", journalStatus: "ok" }),
    });
    expect([...ipc.handlers.keys()]).toEqual(["app.health"]);
  });

  it("app.health returns a success wire envelope with the health payload", async () => {
    const ipc = fakeIpcMain();
    const health: AppHealth = { version: "0.1.0", dbStatus: "ok", journalStatus: "not-configured" };
    registerIpcHandlers(ipc, { getHealth: () => health });
    const handler = ipc.handlers.get("app.health");
    expect(handler).toBeDefined();
    const result = (await handler?.({})) as WireResult<AppHealth>;
    expect(result).toEqual({ ok: true, value: health });
  });
});
