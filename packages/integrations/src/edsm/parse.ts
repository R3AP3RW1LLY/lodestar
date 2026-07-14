/**
 * EDSM payload parsers (SSOT Step 4.7, pure). Validate the two EDSM responses we use —
 * `sphere-systems` (name + galactic coords for the spatial index / coordinate backfill)
 * and `bodies` (ring type + reserve level, the only enrichment source of both besides a
 * `Scan`). Ring type + reserve are normalized to LODESTAR's vocabulary (EDSM writes
 * "Metal Rich" with a space; reserve levels are already bare words). Unknown/garbage
 * payloads return a typed error, never throw.
 */

import type { DomainError, Result } from "@lodestar/shared";
import { domainError, err, ok } from "@lodestar/shared";

export interface EdsmSystem {
  readonly name: string;
  readonly coords: { readonly x: number; readonly y: number; readonly z: number };
  readonly distanceLy?: number;
}

export interface EdsmRing {
  readonly name: string;
  readonly ringType: string;
}

export interface EdsmBody {
  readonly name: string;
  readonly bodyType?: string;
  readonly reserve?: string;
  readonly rings: readonly EdsmRing[];
}

export interface EdsmSystemBodies {
  readonly systemName: string;
  readonly bodies: readonly EdsmBody[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** EDSM ring type ("Metal Rich") → LODESTAR (`Icy|Rocky|Metallic|MetalRich`). */
export function normalizeEdsmRingType(type: string): string {
  return type === "Metal Rich" ? "MetalRich" : type;
}

/** EDSM reserve ("Pristine", or "PristineResources" if a raw form leaks through) → bare word. */
export function normalizeEdsmReserve(reserve: string): string {
  return reserve.replace(/Resources$/, "");
}

/** Parse an EDSM `sphere-systems` / `cube-systems` array (systems that carry coordinates). */
export function parseEdsmSystems(raw: unknown): Result<EdsmSystem[], DomainError> {
  if (!Array.isArray(raw)) {
    return err(domainError("edsm/bad-systems", "expected an array of systems"));
  }
  const systems: EdsmSystem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.name !== "string") {
      return err(domainError("edsm/bad-system", "system entry missing a string name"));
    }
    const coords = entry.coords;
    if (
      !isRecord(coords) ||
      !isFiniteNumber(coords.x) ||
      !isFiniteNumber(coords.y) ||
      !isFiniteNumber(coords.z)
    ) {
      // A system without coordinates is skipped (EDSM omits them when unknown) — not an error.
      continue;
    }
    systems.push({
      name: entry.name,
      coords: { x: coords.x, y: coords.y, z: coords.z },
      ...(isFiniteNumber(entry.distance) ? { distanceLy: entry.distance } : {}),
    });
  }
  return ok(systems);
}

function parseRing(raw: unknown): EdsmRing | undefined {
  if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.type !== "string")
    return undefined;
  return { name: raw.name, ringType: normalizeEdsmRingType(raw.type) };
}

function parseBody(raw: unknown): EdsmBody | undefined {
  if (!isRecord(raw) || typeof raw.name !== "string") return undefined;
  const rings: EdsmRing[] = [];
  if (Array.isArray(raw.rings)) {
    for (const ring of raw.rings) {
      const parsed = parseRing(ring);
      if (parsed !== undefined) rings.push(parsed);
    }
  }
  const bodyType = typeof raw.type === "string" ? raw.type : undefined;
  const reserve =
    typeof raw.reserveLevel === "string" ? normalizeEdsmReserve(raw.reserveLevel) : undefined;
  return {
    name: raw.name,
    ...(bodyType === undefined ? {} : { bodyType }),
    ...(reserve === undefined ? {} : { reserve }),
    rings,
  };
}

/** Parse an EDSM `bodies` response ({ name, bodies: [{ name, type, reserveLevel, rings }] }). */
export function parseEdsmBodies(raw: unknown): Result<EdsmSystemBodies, DomainError> {
  if (!isRecord(raw) || typeof raw.name !== "string") {
    return err(domainError("edsm/bad-bodies", "expected a system object with a name"));
  }
  const bodies: EdsmBody[] = [];
  if (Array.isArray(raw.bodies)) {
    for (const body of raw.bodies) {
      const parsed = parseBody(body);
      if (parsed !== undefined) bodies.push(parsed);
    }
  }
  return ok({ systemName: raw.name, bodies });
}
