import { describe, expect, it, vi } from "vitest";
import { acquireSingleInstance } from "./app-lifecycle.js";

describe("acquireSingleInstance", () => {
  it("proceeds and wires the second-instance focus handler when the lock is acquired", () => {
    const on = vi.fn();
    const focus = vi.fn();
    const app = { requestSingleInstanceLock: () => true, on, quit: vi.fn() };
    const proceed = acquireSingleInstance(app, focus);
    expect(proceed).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
    expect(on).toHaveBeenCalledWith("second-instance", expect.any(Function));
    // Firing the wired handler focuses the existing window.
    const handler = on.mock.calls[0]?.[1] as () => void;
    handler();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("quits and does not proceed when the lock is already held (second launch)", () => {
    const app = { requestSingleInstanceLock: () => false, on: vi.fn(), quit: vi.fn() };
    const proceed = acquireSingleInstance(app, vi.fn());
    expect(proceed).toBe(false);
    expect(app.quit).toHaveBeenCalledOnce();
  });
});
