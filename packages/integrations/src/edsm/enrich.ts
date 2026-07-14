/**
 * EDSM → galaxy-tables enrichment (SSOT Step 4.7). Pure over INJECTED repositories (the
 * `@lodestar/data` repo interfaces are type-only imports — integrations never loads the
 * native DB itself; the consumer passes real repos). Systems backfill coordinates;
 * bodies backfill ring type + reserve onto an EXISTING system (the bodies endpoint
 * returns no coords, so the system must already exist from a sphere search or journal).
 */

import type { BodyRepository, RingRepository, SystemRepository } from "@lodestar/data";
import type { EdsmSystem, EdsmSystemBodies } from "./parse.js";

export interface GalaxyRepos {
  readonly systems: SystemRepository;
  readonly bodies: BodyRepository;
  readonly rings: RingRepository;
}

/** Upsert EDSM systems (name + coordinate backfill). Returns the count written. */
export function enrichSystemsFromEdsm(
  repos: GalaxyRepos,
  systems: readonly EdsmSystem[],
  at: string,
): number {
  for (const system of systems) {
    repos.systems.upsert({ name: system.name, ...system.coords }, at);
  }
  return systems.length;
}

export interface BodyEnrichResult {
  readonly system: "found" | "missing";
  readonly bodies: number;
  readonly rings: number;
}

/**
 * Backfill body/ring type + reserve onto an already-known system. If the system isn't in
 * the DB yet (no coords to create it), returns `system: "missing"` and writes nothing.
 */
export function enrichBodiesFromEdsm(
  repos: GalaxyRepos,
  data: EdsmSystemBodies,
  at: string,
): BodyEnrichResult {
  const system = repos.systems.byName(data.systemName);
  if (system === undefined) return { system: "missing", bodies: 0, rings: 0 };
  let bodies = 0;
  let rings = 0;
  for (const body of data.bodies) {
    if (body.rings.length === 0) continue; // only ring-bearing bodies enrich the galaxy tables
    const bodyId = repos.bodies.upsert(
      { systemId: system.id, name: body.name, bodyType: body.bodyType ?? null },
      at,
    );
    bodies += 1;
    for (const ring of body.rings) {
      repos.rings.upsert(
        { bodyId, name: ring.name, ringType: ring.ringType, reserve: body.reserve ?? null },
        at,
      );
      rings += 1;
    }
  }
  return { system: "found", bodies, rings };
}
