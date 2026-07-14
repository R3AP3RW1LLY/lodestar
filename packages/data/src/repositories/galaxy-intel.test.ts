import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "../index.js";
import type { Db } from "../db.js";
import {
  createBodyRepository,
  createHotspotRepository,
  createOverlapRepository,
  createRingRepository,
  createRunRepository,
  createStationRepository,
  createSystemRepository,
} from "./index.js";

let db: Db;
let ringId: number;
let systemId: number;

beforeEach(() => {
  db = openDatabase(":memory:");
  applyMigrations(db, MIGRATIONS);
  systemId = createSystemRepository(db).upsert({ name: "Paesia", x: 0, y: 0, z: 0 }, "t");
  const bodyId = createBodyRepository(db).upsert(
    { systemId, name: "Paesia 2", bodyType: "HMC" },
    "t",
  );
  ringId = createRingRepository(db).upsert(
    { bodyId, name: "Paesia 2 A Ring", ringType: "Icy", reserve: "Pristine" },
    "t",
  );
});
afterEach(() => db.close());

describe("bodies + rings + stations", () => {
  it("upserts and looks up bodies by system", () => {
    const bodies = createBodyRepository(db).bySystem(systemId);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ name: "Paesia 2", bodyType: "HMC" });
  });

  it("finds rings by body and by system (join), carrying ring type + reserve", () => {
    const rings = createRingRepository(db).bySystem(systemId);
    expect(rings[0]).toMatchObject({
      name: "Paesia 2 A Ring",
      ringType: "Icy",
      reserve: "Pristine",
    });
    expect(createRingRepository(db).byBody(rings[0]?.bodyId ?? 0)).toHaveLength(1);
  });

  it("upserts a station and merges fields on re-upsert (COALESCE keeps known values)", () => {
    const repo = createStationRepository(db);
    const id = repo.upsert({ systemId, name: "Mining Base", padSize: "L" }, "t1");
    repo.upsert({ systemId, name: "Mining Base", distanceLs: 120, marketId: 42 }, "t2");
    const s = repo.bySystem(systemId).find((x) => x.id === id);
    expect(s).toMatchObject({ padSize: "L", distanceLs: 120, marketId: 42, updatedAt: "t2" });
  });
});

describe("hotspots", () => {
  it("records a hotspot, then a re-scan refreshes count + last_confirmed but keeps first_seen", () => {
    const repo = createHotspotRepository(db);
    const id = repo.record({ ringId, commodityId: "painite", count: 2 }, "2025-06-01T00:00:00Z");
    const again = repo.record({ ringId, commodityId: "painite", count: 3 }, "2025-06-05T00:00:00Z");
    expect(again).toBe(id); // same row
    const h = repo.byRing(ringId)[0];
    expect(h).toMatchObject({
      count: 3,
      firstSeen: "2025-06-01T00:00:00Z",
      lastConfirmed: "2025-06-05T00:00:00Z",
    });
  });

  it("finds hotspots by commodity across rings, highest count first", () => {
    const repo = createHotspotRepository(db);
    repo.record({ ringId, commodityId: "painite", count: 2 }, "t");
    repo.record({ ringId, commodityId: "platinum", count: 5, source: "seed" }, "t");
    expect(repo.byCommodity("painite").map((h) => h.commodityId)).toEqual(["painite"]);
    expect(repo.byCommodity("platinum")[0]).toMatchObject({ count: 5, source: "seed" });
  });
});

describe("overlaps", () => {
  it("records a candidate, lists by ring, and confirms it", () => {
    const repo = createOverlapRepository(db);
    const id = repo.record({ ringId, commodities: ["painite", "platinum"] }, "t");
    const before = repo.byRing(ringId)[0];
    expect(before).toMatchObject({
      commodities: ["painite", "platinum"],
      multiplicity: 2,
      confidence: "candidate",
    });
    repo.confirm(id, "t2");
    expect(repo.byRing(ringId)[0]?.confidence).toBe("confirmed");
  });
});

describe("repository defaults + not-found paths", () => {
  it("systems: byId/byName return undefined for an unknown key", () => {
    const repo = createSystemRepository(db);
    expect(repo.byId(999)).toBeUndefined();
    expect(repo.byName("Nowhere")).toBeUndefined();
  });

  it("bodies/rings/stations upsert with only required fields (optionals default to null)", () => {
    const bodyId = createBodyRepository(db).upsert({ systemId, name: "Bare Body" }, "t");
    expect(
      createBodyRepository(db)
        .bySystem(systemId)
        .find((b) => b.id === bodyId)?.bodyType,
    ).toBeNull();
    const rId = createRingRepository(db).upsert({ bodyId, name: "Bare Ring" }, "t");
    const bareRing = createRingRepository(db)
      .byBody(bodyId)
      .find((r) => r.id === rId);
    expect(bareRing).toMatchObject({ ringType: null, reserve: null });
    const sId = createStationRepository(db).upsert({ systemId, name: "Bare Station" }, "t");
    const bareStation = createStationRepository(db)
      .bySystem(systemId)
      .find((s) => s.id === sId);
    expect(bareStation).toMatchObject({
      padSize: null,
      stationType: null,
      distanceLs: null,
      marketId: null,
    });
  });

  it("hotspots: record defaults count to 1 and source to journal", () => {
    const repo = createHotspotRepository(db);
    repo.record({ ringId, commodityId: "gold" }, "t");
    expect(repo.byRing(ringId).find((h) => h.commodityId === "gold")).toMatchObject({
      count: 1,
      source: "journal",
    });
  });

  it("overlaps: a corrupt commodities blob degrades to an empty array (never throws)", () => {
    db.prepare(
      "INSERT INTO overlaps (ring_id, commodities, multiplicity, confidence, source, updated_at) VALUES (?, 'garbage', 2, 'candidate', 'journal', 't')",
    ).run(ringId);
    const o = createOverlapRepository(db).byRing(ringId);
    expect(o[0]?.commodities).toEqual([]);
  });

  it("runs: create without estimates; byId is undefined for an unknown id", () => {
    const repo = createRunRepository(db);
    const id = repo.create({ plan: "{}" }, "t");
    expect(repo.byId(id)).toMatchObject({ estimatedTph: null, estimatedCph: null });
    expect(repo.byId(999)).toBeUndefined();
  });
});

describe("runs", () => {
  it("creates a planned run, then completes it with actuals", () => {
    const repo = createRunRepository(db);
    const id = repo.create(
      { plan: '{"legs":[]}', estimatedTph: 120, estimatedCph: 150_000_000 },
      "t",
    );
    expect(repo.byId(id)).toMatchObject({ status: "planned", estimatedTph: 120, actualTph: null });
    repo.complete(id, { tph: 110, cph: 140_000_000 }, "t2");
    expect(repo.byId(id)).toMatchObject({
      status: "completed",
      actualTph: 110,
      actualCph: 140_000_000,
      completedAt: "t2",
    });
    expect(repo.listRecent(10)).toHaveLength(1);
  });
});
