import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  createBodyRepository,
  createRingRepository,
  createSystemRepository,
  MIGRATIONS,
  openDatabase,
} from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { isOk } from "@lodestar/shared";
import { enrichBodiesFromEdsm, enrichSystemsFromEdsm } from "./enrich.js";
import type { GalaxyRepos } from "./enrich.js";
import { parseEdsmBodies, parseEdsmSystems } from "./parse.js";
import { EDSM_PAESIA_BODIES, EDSM_SPHERE_SYSTEMS } from "./fixtures.js";

describe("EDSM enrichment into the galaxy tables", () => {
  let db: Db;
  let repos: GalaxyRepos;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    repos = {
      systems: createSystemRepository(db),
      bodies: createBodyRepository(db),
      rings: createRingRepository(db),
    };
  });
  afterEach(() => db.close());

  const parsedSystems = () => {
    const r = parseEdsmSystems(EDSM_SPHERE_SYSTEMS);
    if (!isOk(r)) throw new Error("fixture parse failed");
    return r.value;
  };
  const parsedBodies = () => {
    const r = parseEdsmBodies(EDSM_PAESIA_BODIES);
    if (!isOk(r)) throw new Error("fixture parse failed");
    return r.value;
  };

  it("backfills system coordinates", () => {
    const n = enrichSystemsFromEdsm(repos, parsedSystems(), "2025-06-01T00:00:00Z");
    expect(n).toBe(2);
    expect(repos.systems.byName("Sirius")).toMatchObject({ x: 6.25, y: -1.28125, z: -5.75 });
  });

  it("fills ring type + reserve onto an existing system (the scoring inputs)", () => {
    repos.systems.upsert({ name: "Paesia", x: -25, y: 40, z: -7 }, "t");
    const result = enrichBodiesFromEdsm(repos, parsedBodies(), "2025-06-02T00:00:00Z");
    expect(result).toEqual({ system: "found", bodies: 2, rings: 2 }); // the star (no rings) is skipped
    const rings = repos.rings.bySystem(repos.systems.byName("Paesia")?.id ?? 0);
    expect(rings.find((r) => r.name === "Paesia 2 A Ring")).toMatchObject({
      ringType: "Metallic",
      reserve: "Pristine",
    });
    expect(rings.find((r) => r.name === "Paesia 5 A Ring")).toMatchObject({
      ringType: "MetalRich",
      reserve: "Major",
    });
  });

  it("writes nothing when the system isn't known yet (no coordinates to create it)", () => {
    const result = enrichBodiesFromEdsm(repos, parsedBodies(), "t");
    expect(result).toEqual({ system: "missing", bodies: 0, rings: 0 });
    expect(repos.systems.byName("Paesia")).toBeUndefined();
  });

  it("enriches a ring-bearing body that carries no type or reserve (defaults to null)", () => {
    repos.systems.upsert({ name: "Bare", x: 1, y: 2, z: 3 }, "t");
    const result = enrichBodiesFromEdsm(
      repos,
      {
        systemName: "Bare",
        bodies: [{ name: "Bare 1", rings: [{ name: "Bare 1 A Ring", ringType: "Icy" }] }],
      },
      "t",
    );
    expect(result).toEqual({ system: "found", bodies: 1, rings: 1 });
    const ring = repos.rings.bySystem(repos.systems.byName("Bare")?.id ?? 0)[0];
    expect(ring).toMatchObject({ ringType: "Icy", reserve: null });
  });

  it("enrichment does not clobber a reserve already present (repository COALESCE)", () => {
    const systemId = repos.systems.upsert({ name: "Paesia", x: -25, y: 40, z: -7 }, "t");
    const bodyId = repos.bodies.upsert({ systemId, name: "Paesia 2" }, "t");
    repos.rings.upsert(
      { bodyId, name: "Paesia 2 A Ring", ringType: "Metallic", reserve: "Pristine" },
      "t",
    );
    // A later EDSM enrichment with the same data keeps the row consistent (one ring).
    enrichBodiesFromEdsm(repos, parsedBodies(), "t2");
    expect(repos.rings.byBody(bodyId)).toHaveLength(1);
  });
});
