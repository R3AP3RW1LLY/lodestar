/**
 * IPC handler registration. Every invoke channel returns the §5.6 serialized
 * wire result so DomainError never crosses as a class instance. The renderer
 * only ever sees channels registered here.
 */

import type { AppHealth, Channel, WireResult } from "@lodestar/shared";
import { ok, toWireResult } from "@lodestar/shared";

export interface IpcMainLike {
  handle: (channel: Channel, listener: (...args: unknown[]) => unknown) => void;
}

export interface IpcDeps {
  readonly getHealth: () => AppHealth;
}

export function registerIpcHandlers(ipcMain: IpcMainLike, deps: IpcDeps): void {
  ipcMain.handle("app.health", (): WireResult<AppHealth> => toWireResult(ok(deps.getHealth())));
}
