/**
 * DomainError — every fallible operation's error type (SSOT §4.1): a stable
 * machine-readable code, a human message, and an optional cause chain.
 * WireError/WireResult are the §5.6 IPC serializations — plain objects only,
 * because Electron's structured clone does not preserve class identity.
 *
 * MESSAGE HYGIENE (convention of record): DomainError messages cross the IPC
 * boundary to renderer/overlay windows and are written to logs. Never embed
 * secrets, tokens, webhook URLs, or user-identifying filesystem paths in a
 * message — reference them indirectly (e.g. "the configured journal path").
 */

import type { Result } from "./result.js";

export interface DomainError {
  readonly code: string;
  readonly message: string;
  readonly cause?: DomainError | undefined;
}

export function domainError(code: string, message: string, cause?: DomainError): DomainError {
  return cause === undefined ? { code, message } : { code, message, cause };
}

/**
 * Defense-in-depth: `cause` is readonly and `domainError` cannot build a
 * cycle, but a runtime cast could. An unbounded walk here would hang the
 * single-threaded Electron main process on the error path, so depth is capped.
 */
const MAX_CAUSE_DEPTH = 64;

/** Outermost-first, one `code: message` entry per link in the cause chain. */
export function causeChain(error: DomainError): string[] {
  const chain: string[] = [];
  let current: DomainError | undefined = error;
  while (current !== undefined) {
    if (chain.length >= MAX_CAUSE_DEPTH) {
      chain.push("...(cause chain truncated)");
      break;
    }
    chain.push(`${current.code}: ${current.message}`);
    current = current.cause;
  }
  return chain;
}

export interface WireError {
  readonly code: string;
  readonly message: string;
  readonly causeChain: readonly string[];
}

export function toWireError(error: DomainError): WireError {
  return { code: error.code, message: error.message, causeChain: causeChain(error) };
}

export type WireResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WireError };

export function toWireResult<T>(result: Result<T, DomainError>): WireResult<T> {
  return result.ok
    ? { ok: true, value: result.value }
    : { ok: false, error: toWireError(result.error) };
}
