import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  createBodyRepository,
  createHotspotRepository,
  createRingRepository,
  createSystemRepository,
  MIGRATIONS,
  openDatabase,
} from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createVeinBridge, emptyVeinBridge } from "./vein-wiring.js";

describe("vein bridge", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    const p = createSystemRepository(db).upsert({ name: "Paesia", x: 0, y: 0, z: 0 }, "t");
    const body = createBodyRepository(db).upsert({ systemId: p, name: "Paesia 2" }, "t");
    const ring = createRingRepository(db).upsert({ bodyId: body, name: "Paesia 2 A Ring" }, "t");
    createHotspotRepository(db).record({ ringId: ring, commodityId: "painite", count: 2 }, "t");
  });
  afterEach(() => db.close());

  it("finds candidates and measures distance from the supplied origin", () => {
    const bridge = createVeinBridge(
      db,
      () => ({ x: 3, y: 4, z: 0 }),
      () => 0,
    );
    const found = bridge.find({});
    expect(found).toHaveLength(1);
    expect(found[0]?.distanceLy).toBeCloseTo(5); // (3,4,0) → (0,0,0)
  });

  it("reports null distance when the origin is unknown", () => {
    const bridge = createVeinBridge(
      db,
      () => undefined,
      () => 0,
    );
    expect(bridge.find({})[0]?.distanceLy).toBeNull();
  });

  it("empty bridge returns nothing", () => {
    expect(emptyVeinBridge().find({})).toEqual([]);
  });
});
