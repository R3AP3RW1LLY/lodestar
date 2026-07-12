/**
 * Logger contract (SSOT §4.1). The pino-backed implementation with rotation
 * and secret redaction lives in the Electron app (Step 0.4); packages depend
 * only on this interface. Levels mirror pino's severity order.
 */

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Readonly<Record<string, unknown>>;

export type Logger = {
  readonly [level in LogLevel]: (message: string, fields?: LogFields) => void;
} & {
  readonly child: (bindings: LogFields) => Logger;
};

/** A safe no-op logger for tests and default wiring. */
export const nullLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
  child: () => nullLogger,
};
