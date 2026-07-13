/**
 * Shared sidecar supervisor (SSOT Step 2.7). Owns the lifecycle of one long-running
 * child process (a "sidecar") — spawn, liveness, crash-restart-with-backoff, and an
 * ORDERED shutdown (SIGTERM → grace → SIGKILL). Piper (TTS) is its first client;
 * the ML + STT sidecars (Phases 6–7) reuse it unchanged. All process I/O is behind
 * an injected `SpawnSidecar`, so the whole state machine is driven deterministically
 * by a scripted test double in tests — no real child process required.
 *
 * Crash-loop protection: automatic restarts are counted within a rolling window; if
 * the sidecar dies more than `maxRestarts` times inside `windowMs`, the supervisor
 * gives up (status `failed`) rather than thrashing — a later `start()` clears the
 * count and tries again (a manual operator restart). A `stop()` is cooperative and
 * NEVER triggers a restart.
 */

import type { Logger } from "@lodestar/shared";
import { nullLogger } from "@lodestar/shared";

export interface SidecarSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** A spawned child. The adapter over Node's `child_process` lives in the desktop main. */
export interface SidecarHandle {
  readonly pid: number | undefined;
  write(data: string): void;
  onStdout(fn: (chunk: string) => void): void;
  onStderr(fn: (chunk: string) => void): void;
  onExit(fn: (code: number | null, signal: string | null) => void): void;
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export type SpawnSidecar = (spec: SidecarSpec) => SidecarHandle;

export type SupervisorStatus = "stopped" | "running" | "restarting" | "failed";

export interface SupervisorOptions {
  readonly spec: SidecarSpec;
  readonly spawn: SpawnSidecar;
  /** Max automatic restarts within `windowMs` before giving up (default 5). */
  readonly maxRestarts?: number;
  /** Rolling window (ms) over which restarts are counted (default 60_000). */
  readonly windowMs?: number;
  /** Backoff before restart attempt N (1-based), ms (default min(30s, 500·2^(N−1))). */
  readonly backoffMs?: (attempt: number) => number;
  /** Grace after SIGTERM before SIGKILL on `stop()` (ms, default 3_000). */
  readonly shutdownGraceMs?: number;
  readonly logger?: Logger;
  /** Notified on every status transition (drives the status bar / telemetry). */
  readonly onStatus?: (status: SupervisorStatus) => void;
  /** Monotonic clock for the restart window; defaults to `Date.now`. */
  readonly now?: () => number;
}

export interface Supervisor {
  /** Spawn the sidecar (no-op if already running/restarting). */
  start(): void;
  /** Ordered shutdown; resolves once the child has exited. Never restarts. */
  stop(): Promise<void>;
  status(): SupervisorStatus;
  /** The live child handle for a client to read/write, or undefined. */
  handle(): SidecarHandle | undefined;
  /** Total automatic restarts performed this lifetime. */
  restarts(): number;
}

/** Exponential restart backoff: 500ms, 1s, 2s, 4s, … clamped at 30s. */
export const defaultSidecarBackoff = (attempt: number): number =>
  Math.min(30_000, 500 * 2 ** (attempt - 1));

export function createSupervisor(opts: SupervisorOptions): Supervisor {
  const logger = opts.logger ?? nullLogger;
  const now = opts.now ?? Date.now;
  const maxRestarts = opts.maxRestarts ?? 5;
  const windowMs = opts.windowMs ?? 60_000;
  const backoffMs = opts.backoffMs ?? defaultSidecarBackoff;
  const shutdownGraceMs = opts.shutdownGraceMs ?? 3_000;

  let status: SupervisorStatus = "stopped";
  let current: SidecarHandle | undefined;
  let stopping = false;
  let totalRestarts = 0;
  let crashTimes: number[] = [];
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let onExited: (() => void) | undefined;
  let stopPromise: Promise<void> | undefined;

  function setStatus(next: SupervisorStatus): void {
    if (status === next) return;
    status = next;
    opts.onStatus?.(next);
  }

  function spawnNow(): void {
    const handle = opts.spawn(opts.spec);
    current = handle;
    handle.onExit((code, signal) => {
      // Ignore a stale exit from a handle we've already superseded (after a restart):
      // it must not clobber the live child or trigger a spurious restart.
      if (handle !== current) return;
      handleExit(code, signal);
    });
    setStatus("running");
  }

  function handleExit(code: number | null, signal: string | null): void {
    current = undefined;
    if (stopping) {
      setStatus("stopped");
      const done = onExited;
      onExited = undefined;
      done?.();
      return;
    }
    logger.warn("sidecar.crashed", {
      command: opts.spec.command,
      code: code ?? undefined,
      signal: signal ?? undefined,
    });
    const t = now();
    crashTimes = crashTimes.filter((ts) => t - ts < windowMs);
    crashTimes.push(t);
    if (crashTimes.length > maxRestarts) {
      logger.error("sidecar.restart-limit", {
        command: opts.spec.command,
        crashes: crashTimes.length,
        windowMs,
      });
      setStatus("failed");
      return;
    }
    setStatus("restarting");
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      totalRestarts += 1;
      spawnNow();
    }, backoffMs(crashTimes.length));
  }

  return {
    start() {
      if (status === "running" || status === "restarting") return;
      stopping = false;
      crashTimes = [];
      spawnNow();
    },
    stop() {
      if (stopPromise !== undefined) return stopPromise; // a shutdown is already in flight
      stopping = true;
      if (restartTimer !== undefined) {
        clearTimeout(restartTimer);
        restartTimer = undefined;
      }
      const handle = current;
      if (handle === undefined) {
        setStatus("stopped");
        return Promise.resolve();
      }
      stopPromise = new Promise<void>((resolve) => {
        const grace = setTimeout(() => {
          handle.kill("SIGKILL");
        }, shutdownGraceMs);
        onExited = () => {
          clearTimeout(grace);
          stopPromise = undefined;
          resolve();
        };
        handle.kill("SIGTERM");
      });
      return stopPromise;
    },
    status: () => status,
    handle: () => current,
    restarts: () => totalRestarts,
  };
}
