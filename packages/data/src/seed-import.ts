/**
 * Seed import (SSOT Step 4.2) — the clean-room starter dataset of famous, publicly
 * documented mining locations, hand-authored (never copied from another tool) with
 * an explicit provenance note per entry. `parseSeedFile` validates the JSON shape and
 * every commodity id against the canonical dictionary (Step 2.2); `importSeed` folds
 * it into the galaxy tables with `source='seed'`, idempotently — a re-import upserts
 * (no duplicate rows) and refreshes `last_confirmed` while keeping `first_seen`.
 *
 * The DB grows primarily from the commander's OWN scans (Step 4.3) and later community
 * sync (Phase 10); seed coordinates are approximate public galactic reference,
 * authoritatively refined by EDSM enrichment (Step 4.7).
 */

import type { DomainError, Result } from "@lodestar/shared";
import { commodityById, domainError, err, ok } from "@lodestar/shared";
import type { Db } from "./db.js";
import {
  createBodyRepository,
  createHotspotRepository,
  createRingRepository,
  createSystemRepository,
} from "./repositories/index.js";

export interface SeedHotspot {
  readonly commodityId: string;
  readonly count?: number;
}

export interface SeedRing {
  readonly name: string;
  readonly ringType?: string;
  readonly reserve?: string;
  /** Why this entry is trusted + where it came from (never another tool's dataset). */
  readonly provenance: string;
  readonly hotspots: readonly SeedHotspot[];
}

export interface SeedBody {
  readonly name: string;
  readonly bodyType?: string;
  readonly rings: readonly SeedRing[];
}

export interface SeedSystem {
  readonly name: string;
  readonly address?: number;
  readonly coords: { readonly x: number; readonly y: number; readonly z: number };
  /** Always true in the shipped seed — coords are approximate, EDSM-refined (Step 4.7). */
  readonly coordsApproximate?: boolean;
  readonly bodies: readonly SeedBody[];
}

export interface SeedFile {
  readonly version: number;
  readonly note?: string;
  readonly systems: readonly SeedSystem[];
}

export interface SeedImportSummary {
  readonly systems: number;
  readonly bodies: number;
  readonly rings: number;
  readonly hotspots: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseHotspot(raw: unknown): Result<SeedHotspot, DomainError> {
  if (!isRecord(raw) || typeof raw.commodityId !== "string") {
    return err(domainError("seed/bad-hotspot", "hotspot must have a string commodityId"));
  }
  if (commodityById(raw.commodityId) === undefined) {
    return err(domainError("seed/unknown-commodity", `unknown commodity id: ${raw.commodityId}`));
  }
  if (raw.count !== undefined) {
    if (!isFiniteNumber(raw.count) || !Number.isInteger(raw.count) || raw.count < 1) {
      return err(domainError("seed/bad-hotspot", "hotspot count must be a positive integer"));
    }
    return ok({ commodityId: raw.commodityId, count: raw.count });
  }
  return ok({ commodityId: raw.commodityId });
}

function parseRing(raw: unknown): Result<SeedRing, DomainError> {
  if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.length === 0) {
    return err(domainError("seed/bad-ring", "ring must have a non-empty name"));
  }
  if (typeof raw.provenance !== "string" || raw.provenance.trim().length === 0) {
    return err(domainError("seed/missing-provenance", `ring "${raw.name}" is missing provenance`));
  }
  if (!Array.isArray(raw.hotspots) || raw.hotspots.length === 0) {
    return err(domainError("seed/bad-ring", `ring "${raw.name}" must list at least one hotspot`));
  }
  const hotspots: SeedHotspot[] = [];
  for (const rawHotspot of raw.hotspots) {
    const parsed = parseHotspot(rawHotspot);
    if (!parsed.ok) return parsed;
    hotspots.push(parsed.value);
  }
  const ringType = optionalString(raw.ringType);
  const reserve = optionalString(raw.reserve);
  return ok({
    name: raw.name,
    ...(ringType === undefined ? {} : { ringType }),
    ...(reserve === undefined ? {} : { reserve }),
    provenance: raw.provenance,
    hotspots,
  });
}

function parseBody(raw: unknown): Result<SeedBody, DomainError> {
  if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.length === 0) {
    return err(domainError("seed/bad-body", "body must have a non-empty name"));
  }
  if (!Array.isArray(raw.rings) || raw.rings.length === 0) {
    return err(domainError("seed/bad-body", `body "${raw.name}" must list at least one ring`));
  }
  const rings: SeedRing[] = [];
  for (const rawRing of raw.rings) {
    const parsed = parseRing(rawRing);
    if (!parsed.ok) return parsed;
    rings.push(parsed.value);
  }
  const bodyType = optionalString(raw.bodyType);
  return ok({ name: raw.name, ...(bodyType === undefined ? {} : { bodyType }), rings });
}

function parseSystem(raw: unknown): Result<SeedSystem, DomainError> {
  if (!isRecord(raw) || typeof raw.name !== "string" || raw.name.length === 0) {
    return err(domainError("seed/bad-system", "system must have a non-empty name"));
  }
  const coords = raw.coords;
  if (
    !isRecord(coords) ||
    !isFiniteNumber(coords.x) ||
    !isFiniteNumber(coords.y) ||
    !isFiniteNumber(coords.z)
  ) {
    return err(domainError("seed/bad-coords", `system "${raw.name}" has non-finite coordinates`));
  }
  if (raw.address !== undefined && !isFiniteNumber(raw.address)) {
    return err(domainError("seed/bad-system", `system "${raw.name}" has a non-numeric address`));
  }
  if (!Array.isArray(raw.bodies) || raw.bodies.length === 0) {
    return err(domainError("seed/bad-system", `system "${raw.name}" must list at least one body`));
  }
  const bodies: SeedBody[] = [];
  for (const rawBody of raw.bodies) {
    const parsed = parseBody(rawBody);
    if (!parsed.ok) return parsed;
    bodies.push(parsed.value);
  }
  return ok({
    name: raw.name,
    ...(raw.address === undefined ? {} : { address: raw.address }),
    coords: { x: coords.x, y: coords.y, z: coords.z },
    ...(raw.coordsApproximate === true ? { coordsApproximate: true } : {}),
    bodies,
  });
}

/** Validate an untrusted seed payload into a typed `SeedFile` (or a typed error). */
export function parseSeedFile(raw: unknown): Result<SeedFile, DomainError> {
  if (!isRecord(raw)) {
    return err(domainError("seed/not-object", "seed file must be a JSON object"));
  }
  if (!isFiniteNumber(raw.version) || raw.version < 1) {
    return err(domainError("seed/bad-version", "seed file needs a version >= 1"));
  }
  if (!Array.isArray(raw.systems) || raw.systems.length === 0) {
    return err(domainError("seed/no-systems", "seed file must list at least one system"));
  }
  const systems: SeedSystem[] = [];
  for (const rawSystem of raw.systems) {
    const parsed = parseSystem(rawSystem);
    if (!parsed.ok) return parsed;
    systems.push(parsed.value);
  }
  const note = optionalString(raw.note);
  return ok({ version: raw.version, ...(note === undefined ? {} : { note }), systems });
}

/**
 * Fold a validated seed into the galaxy tables (`source='seed'`), idempotently, in a
 * single transaction. Returns a count of the entries processed at each level.
 */
export function importSeed(db: Db, seed: SeedFile, at: string): SeedImportSummary {
  const systemRepo = createSystemRepository(db);
  const bodyRepo = createBodyRepository(db);
  const ringRepo = createRingRepository(db);
  const hotspotRepo = createHotspotRepository(db);
  let systems = 0;
  let bodies = 0;
  let rings = 0;
  let hotspots = 0;

  const run = db.transaction(() => {
    for (const system of seed.systems) {
      const systemId = systemRepo.upsert(
        { address: system.address ?? null, name: system.name, ...system.coords },
        at,
      );
      systems += 1;
      for (const body of system.bodies) {
        const bodyId = bodyRepo.upsert(
          { systemId, name: body.name, bodyType: body.bodyType ?? null },
          at,
        );
        bodies += 1;
        for (const ring of body.rings) {
          const ringId = ringRepo.upsert(
            {
              bodyId,
              name: ring.name,
              ringType: ring.ringType ?? null,
              reserve: ring.reserve ?? null,
            },
            at,
          );
          rings += 1;
          for (const hotspot of ring.hotspots) {
            hotspotRepo.record(
              {
                ringId,
                commodityId: hotspot.commodityId,
                ...(hotspot.count === undefined ? {} : { count: hotspot.count }),
                source: "seed",
              },
              at,
            );
            hotspots += 1;
          }
        }
      }
    }
  });
  run();
  return { systems, bodies, rings, hotspots };
}
