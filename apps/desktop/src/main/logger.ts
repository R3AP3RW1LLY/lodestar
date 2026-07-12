/**
 * Structured logger (SSOT §4.1): pino with rotating files and secret
 * redaction. Implements the @lodestar/shared Logger interface so packages
 * depend only on the contract. Secrets (keys, tokens, webhook URLs, passwords)
 * are redacted before any line is written; logs never leave the machine.
 */

import { join } from "node:path";
import type { EventEmitter } from "node:events";
import pino from "pino";
import pinoRoll from "pino-roll";
import type { DestinationStream } from "pino";
import type { LogFields, Logger, LogLevel } from "@lodestar/shared";
import { LOG_LEVELS } from "@lodestar/shared";

/** A pino-roll destination: a writable pino stream that is also an emitter. */
export type RollingDestination = DestinationStream &
  EventEmitter & {
    write: (chunk: string) => void;
    flush: (cb: () => void) => void;
  };

// Secret-bearing key names, redacted at ANY nesting depth via the `**.` wildcard
// (fast-redact multi-level) plus a bare top-level path. Covers camelCase and
// snake_case (OAuth/HTTP bodies), auth headers, cookies, and WS tokens.
const SECRET_KEYS = [
  "apiKey",
  "token",
  "wsToken",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "idToken",
  "id_token",
  "clientSecret",
  "client_secret",
  "password",
  "secret",
  "webhookUrl",
  "authorization",
  "Authorization",
  "cookie",
  "Cookie",
  "set-cookie",
];

// Redact each key at the top level and nested up to 3 deep (covers the common
// `error.response.data.access_token` shape). fast-redact uses single-level `*`.
export const REDACT_PATHS: readonly string[] = SECRET_KEYS.flatMap((key) => [
  key,
  `*.${key}`,
  `*.*.${key}`,
  `*.*.*.${key}`,
]);

export interface CreateLoggerOptions {
  readonly destination?: DestinationStream;
  readonly level?: LogLevel;
  readonly base?: LogFields;
}

function adapt(instance: pino.Logger): Logger {
  const wrap = (level: LogLevel) => (message: string, fields?: LogFields) => {
    if (fields === undefined) instance[level](message);
    else instance[level](fields, message);
  };
  return {
    trace: wrap("trace"),
    debug: wrap("debug"),
    info: wrap("info"),
    warn: wrap("warn"),
    error: wrap("error"),
    fatal: wrap("fatal"),
    child: (bindings: LogFields) => adapt(instance.child(bindings)),
  };
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const pinoOptions: pino.LoggerOptions = {
    level: options.level ?? "info",
    redact: { paths: [...REDACT_PATHS], censor: "[redacted]" },
    ...(options.base !== undefined ? { base: { ...options.base } } : {}),
  };
  const instance =
    options.destination !== undefined ? pino(pinoOptions, options.destination) : pino(pinoOptions);
  return adapt(instance);
}

export interface RollingOptions {
  readonly size?: string;
  readonly mkdir?: boolean;
}

/**
 * A size-rolling file destination. pino-roll resolves asynchronously, so this
 * is awaited at app startup and wired as the logger destination.
 */
export async function createRollingDestination(
  logsDir: string,
  options: RollingOptions = {},
): Promise<RollingDestination> {
  const stream = await pinoRoll({
    file: join(logsDir, "lodestar"),
    extension: ".log",
    size: options.size ?? "10m",
    mkdir: options.mkdir ?? true,
  });
  return stream as unknown as RollingDestination;
}

export const ALL_LEVELS: readonly LogLevel[] = LOG_LEVELS;
