/**
 * Result<T, E> — the project-wide convention for fallible operations (SSOT §4.1).
 * Exceptions are reserved for process boundaries; domain code returns these.
 */

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok;
}

export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok;
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}

export function andThen<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> {
  return result.ok ? fn(result.value) : result;
}

export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * The canonical throw→Result adapter for process boundaries (fs, JSON.parse,
 * SQLite). Domain code never hand-rolls try/catch around these — it calls
 * fromThrowable so error mapping stays in one shape.
 */
export function fromThrowable<T, E>(fn: () => T, onError: (thrown: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (thrown) {
    return err(onError(thrown));
  }
}

/** Async counterpart of fromThrowable for promise-returning boundaries. */
export async function fromPromise<T, E>(
  promise: Promise<T>,
  onError: (thrown: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await promise);
  } catch (thrown) {
    return err(onError(thrown));
  }
}
