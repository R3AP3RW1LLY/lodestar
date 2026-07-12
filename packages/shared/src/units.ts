/**
 * Branded numeric units (SSOT §Step 0.2). Constructors validate and return
 * Result — invalid magnitudes are unrepresentable downstream, and construction
 * never throws.
 */

import type { DomainError } from "./errors.js";
import { domainError } from "./errors.js";
import type { Result } from "./result.js";
import { err, ok } from "./result.js";

declare const UNIT_BRAND: unique symbol;
type Branded<B extends string> = number & { readonly [UNIT_BRAND]: B };

export type Tons = Branded<"Tons">;
export type Credits = Branded<"Credits">;
export type LightYears = Branded<"LightYears">;
export type Percent = Branded<"Percent">;

/** Normalizes -0 to +0 so branded values never carry a surprising sign bit. */
function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

/** Cargo/refined mass in tons: finite and non-negative. */
export function tons(value: number): Result<Tons, DomainError> {
  if (!Number.isFinite(value) || value < 0) {
    return err(domainError("unit.invalid-tons", `Tons must be a finite number >= 0, got ${String(value)}`));
  }
  return ok(normalizeZero(value) as Tons);
}

/**
 * Credit amounts: non-negative safe integers (the game never pays fractions).
 * ABSOLUTE amounts only — net/delta figures (a losing session) need a signed
 * type and must not reuse this brand.
 */
export function credits(value: number): Result<Credits, DomainError> {
  if (!Number.isSafeInteger(value) || value < 0) {
    return err(
      domainError("unit.invalid-credits", `Credits must be a safe integer >= 0, got ${String(value)}`),
    );
  }
  return ok(normalizeZero(value) as Credits);
}

/** Distances in light-years: finite and non-negative. */
export function lightYears(value: number): Result<LightYears, DomainError> {
  if (!Number.isFinite(value) || value < 0) {
    return err(
      domainError("unit.invalid-light-years", `LightYears must be a finite number >= 0, got ${String(value)}`),
    );
  }
  return ok(normalizeZero(value) as LightYears);
}

/**
 * Percentages (prospector proportions, cargo fill): 0..100 inclusive.
 * There is deliberately no addPercent — summing percentages is almost always
 * the wrong operation (average or re-derive from the underlying ratio instead).
 */
export function percent(value: number): Result<Percent, DomainError> {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return err(
      domainError("unit.invalid-percent", `Percent must be a finite number in 0..100, got ${String(value)}`),
    );
  }
  return ok(normalizeZero(value) as Percent);
}

/*
 * Arithmetic: brands decay under `+` by design (Tons + Tons : number), so the
 * canonical pattern is these helpers — they delegate to the constructor, which
 * is the single owner of validity (overflow to Infinity / past MAX_SAFE_INTEGER
 * returns err, never a corrupt branded value).
 */

export function addTons(a: Tons, b: Tons): Result<Tons, DomainError> {
  return tons(a + b);
}

export function addCredits(a: Credits, b: Credits): Result<Credits, DomainError> {
  return credits(a + b);
}

export function addLightYears(a: LightYears, b: LightYears): Result<LightYears, DomainError> {
  return lightYears(a + b);
}
