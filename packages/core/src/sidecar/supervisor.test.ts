import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupervisor, defaultSidecarBackoff } from "./supervisor.js";
import type { SidecarHandle, SidecarSpec, SpawnSidecar, SupervisorStatus } from "./supervisor.js";

const SPEC: SidecarSpec = { command: "piper", args: ["--model", "en_US-lessac.onnx"] };

interface FakeProc {
  readonly spec: SidecarSpec;
  readonly pid: number;
  readonly kills: string[];
  readonly written: string[];
  triggerExit(code: number | null, signal: string | null): void;
}

/** A scripted fake sidecar — the test drives exits + inspects kills/writes. */
function fakeSpawner(): { spawn: SpawnSidecar; procs: FakeProc[] } {
  const procs: FakeProc[] = [];
  let pid = 2000;
  const spawn: SpawnSidecar = (spec) => {
    pid += 1;
    const exitFns: ((code: number | null, signal: string | null) => void)[] = [];
    const proc: FakeProc = {
      spec,
      pid,
      kills: [],
      written: [],
      triggerExit: (code, signal) => {
        for (const fn of [...exitFns]) fn(code, signal);
      },
    };
    procs.push(proc);
    const handle: SidecarHandle = {
      pid: proc.pid,
      write: (d) => proc.written.push(d),
      onStdout: () => undefined,
      onStderr: () => undefined,
      onExit: (fn) => exitFns.push(fn),
      kill: (sig) => proc.kills.push(sig),
    };
    return handle;
  };
  return { spawn, procs };
}

describe("sidecar supervisor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("spawns the sidecar and reports running + a live handle", () => {
    const { spawn, procs } = fakeSpawner();
    const statuses: SupervisorStatus[] = [];
    const sup = createSupervisor({ spec: SPEC, spawn, onStatus: (s) => statuses.push(s) });
    expect(sup.status()).toBe("stopped");
    sup.start();
    expect(procs).toHaveLength(1);
    expect(procs[0]?.spec.command).toBe("piper");
    expect(sup.status()).toBe("running");
    expect(sup.handle()?.pid).toBe(procs[0]?.pid);
    expect(statuses).toEqual(["running"]);
  });

  it("start() is idempotent while running", () => {
    const { spawn, procs } = fakeSpawner();
    const sup = createSupervisor({ spec: SPEC, spawn });
    sup.start();
    sup.start();
    expect(procs).toHaveLength(1);
  });

  it("restarts on an unexpected crash after the backoff", () => {
    const { spawn, procs } = fakeSpawner();
    const statuses: SupervisorStatus[] = [];
    const sup = createSupervisor({
      spec: SPEC,
      spawn,
      backoffMs: () => 500,
      onStatus: (s) => statuses.push(s),
    });
    sup.start();
    procs[0]?.triggerExit(1, null); // crash
    expect(sup.status()).toBe("restarting");
    expect(procs).toHaveLength(1); // not yet respawned (backoff pending)
    vi.advanceTimersByTime(500);
    expect(procs).toHaveLength(2); // respawned
    expect(sup.status()).toBe("running");
    expect(sup.restarts()).toBe(1);
    expect(statuses).toEqual(["running", "restarting", "running"]);
  });

  it("gives up (failed) after more than maxRestarts crashes within the window", () => {
    const { spawn, procs } = fakeSpawner();
    const sup = createSupervisor({ spec: SPEC, spawn, maxRestarts: 2, backoffMs: () => 100 });
    sup.start();
    procs[0]?.triggerExit(1, null); // crash #1
    vi.advanceTimersByTime(100); // → procs[1]
    procs[1]?.triggerExit(1, null); // crash #2
    vi.advanceTimersByTime(100); // → procs[2]
    procs[2]?.triggerExit(1, null); // crash #3 > maxRestarts 2
    expect(sup.status()).toBe("failed");
    vi.advanceTimersByTime(10_000);
    expect(procs).toHaveLength(3); // no further respawn
  });

  it("forgets crashes older than the window (no false crash-loop)", () => {
    let t = 0;
    const { spawn, procs } = fakeSpawner();
    const sup = createSupervisor({
      spec: SPEC,
      spawn,
      maxRestarts: 1,
      windowMs: 1000,
      backoffMs: () => 10,
      now: () => t,
    });
    sup.start();
    procs[0]?.triggerExit(1, null); // crash at t=0 (count 1)
    vi.advanceTimersByTime(10); // → procs[1]
    t = 2000; // 2s later — the first crash falls outside the 1s window
    procs[1]?.triggerExit(1, null); // count resets to 1, not 2 → still restarts
    vi.advanceTimersByTime(10); // → procs[2]
    expect(procs).toHaveLength(3);
    expect(sup.status()).toBe("running");
  });

  it("ordered shutdown: SIGTERM, and on a graceful exit never SIGKILLs", async () => {
    const { spawn, procs } = fakeSpawner();
    const sup = createSupervisor({ spec: SPEC, spawn, shutdownGraceMs: 3000 });
    sup.start();
    const p = sup.stop();
    expect(procs[0]?.kills).toEqual(["SIGTERM"]);
    procs[0]?.triggerExit(0, "SIGTERM"); // exits within the grace
    await p;
    expect(sup.status()).toBe("stopped");
    expect(procs[0]?.kills).toEqual(["SIGTERM"]); // no SIGKILL
  });

  it("ordered shutdown: SIGKILLs if the child ignores SIGTERM past the grace", async () => {
    const { spawn, procs } = fakeSpawner();
    const sup = createSupervisor({ spec: SPEC, spawn, shutdownGraceMs: 3000 });
    sup.start();
    const p = sup.stop();
    vi.advanceTimersByTime(3000); // grace elapses with no exit
    expect(procs[0]?.kills).toEqual(["SIGTERM", "SIGKILL"]);
    procs[0]?.triggerExit(null, "SIGKILL");
    await p;
    expect(sup.status()).toBe("stopped");
  });

  it("a crash during shutdown never triggers a restart", async () => {
    const { spawn, procs } = fakeSpawner();
    const sup = createSupervisor({ spec: SPEC, spawn });
    sup.start();
    const p = sup.stop();
    procs[0]?.triggerExit(0, "SIGTERM");
    await p;
    expect(sup.status()).toBe("stopped");
    expect(procs).toHaveLength(1); // no respawn
  });

  it("stop() before start() is a no-op that resolves to stopped", async () => {
    const { spawn } = fakeSpawner();
    const sup = createSupervisor({ spec: SPEC, spawn });
    await sup.stop();
    expect(sup.status()).toBe("stopped");
  });

  it("a pending restart backoff is cancelled by stop()", async () => {
    const { spawn, procs } = fakeSpawner();
    const sup = createSupervisor({ spec: SPEC, spawn, backoffMs: () => 500 });
    sup.start();
    procs[0]?.triggerExit(1, null); // crash → restarting (backoff pending)
    expect(sup.status()).toBe("restarting");
    await sup.stop(); // cancels the backoff timer; no live child
    expect(sup.status()).toBe("stopped");
    vi.advanceTimersByTime(1000);
    expect(procs).toHaveLength(1); // the scheduled restart never fired
  });

  it("writes pass through to the live child's stdin", () => {
    const { spawn, procs } = fakeSpawner();
    const sup = createSupervisor({ spec: SPEC, spawn });
    sup.start();
    sup.handle()?.write("Platinum thirty-two percent, mine.\n");
    expect(procs[0]?.written).toEqual(["Platinum thirty-two percent, mine.\n"]);
  });

  it("default backoff is exponential (500ms → clamped at 30s)", () => {
    expect(defaultSidecarBackoff(1)).toBe(500);
    expect(defaultSidecarBackoff(2)).toBe(1000);
    expect(defaultSidecarBackoff(3)).toBe(2000);
    expect(defaultSidecarBackoff(7)).toBe(30_000); // 500·2^6 = 32000 → clamped
    expect(defaultSidecarBackoff(20)).toBe(30_000);
  });

  it("uses the default backoff when none is injected (first restart at 500ms)", () => {
    const { spawn, procs } = fakeSpawner();
    const sup = createSupervisor({ spec: SPEC, spawn }); // no backoffMs → default curve
    sup.start();
    procs[0]?.triggerExit(1, null); // crash → default backoff 500ms
    vi.advanceTimersByTime(499);
    expect(procs).toHaveLength(1); // not yet
    vi.advanceTimersByTime(1);
    expect(procs).toHaveLength(2); // respawned at exactly 500ms
  });

  it("a concurrent stop() returns the same in-flight promise (no orphan/no timer leak)", async () => {
    const { spawn, procs } = fakeSpawner();
    const sup = createSupervisor({ spec: SPEC, spawn, shutdownGraceMs: 3000 });
    sup.start();
    const p1 = sup.stop();
    const p2 = sup.stop(); // must NOT re-send SIGTERM or arm a second grace timer
    expect(procs[0]?.kills).toEqual(["SIGTERM"]); // exactly one SIGTERM
    procs[0]?.triggerExit(0, "SIGTERM");
    await Promise.all([p1, p2]); // both resolve — neither hangs
    expect(sup.status()).toBe("stopped");
    vi.advanceTimersByTime(5000);
    expect(procs[0]?.kills).toEqual(["SIGTERM"]); // grace timer cleared → no late SIGKILL
  });
});
