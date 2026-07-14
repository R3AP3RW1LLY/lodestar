import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyMigrations,
  createBodyRepository,
  createHotspotRepository,
  createOverlapRepository,
  createRingRepository,
  createSystemRepository,
  MIGRATIONS,
  openDatabase,
} from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createVeinService } from "./vein-service.js";

const NOW = Date.parse("2025-06-01T12:00:00Z");

/** Two rings: Paesia (metallic/pristine painite, close, has a market + overlap) and Far (icy/depleted LTD, far). */
function seed(db: Db): void {
  const sys = createSystemRepository(db);
  const bodies = createBodyRepository(db);
  const rings = createRingRepository(db);
  const hs = createHotspotRepository(db);

  const paesia = sys.upsert({ name: "Paesia", x: 0, y: 0, z: 0 }, "t");
  const pBody = bodies.upsert({ systemId: paesia, name: "Paesia 2" }, "t");
  const pRing = rings.upsert(
    { bodyId: pBody, name: "Paesia 2 A Ring", ringType: "Metallic", reserve: "Pristine" },
    "t",
  );
  hs.record({ ringId: pRing, commodityId: "painite", count: 2 }, "2025-06-01T00:00:00Z");
  createOverlapRepository(db).record({ ringId: pRing, commodities: ["painite", "platinum"] }, "t");
  db.prepare(
    `INSERT INTO market_snapshots (commodity_id, market_id, sell_price, source, source_ts, station_name, star_system, pad_size)
     VALUES ('painite', 1, 700000, 'journal', '2025-06-01T12:00:00Z', 'Nemere', 'Paesia', 'L')`,
  ).run();

  const far = sys.upsert({ name: "Far", x: 100, y: 0, z: 0 }, "t");
  const fBody = bodies.upsert({ systemId: far, name: "Far 1" }, "t");
  const fRing = rings.upsert(
    { bodyId: fBody, name: "Far 1 A Ring", ringType: "Icy", reserve: "Depleted" },
    "t",
  );
  hs.record(
    { ringId: fRing, commodityId: "lowtemperaturediamond", count: 1 },
    "2025-05-01T00:00:00Z",
  );
}

describe("vein service", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    seed(db);
  });
  afterEach(() => db.close());

  const svc = () => createVeinService(db, () => NOW);
  const ORIGIN = { x: 0, y: 0, z: 0 };

  it("scores + ranks hotspot candidates with the full 4.5 breakdown", () => {
    const all = svc().candidates({}, ORIGIN, NOW);
    expect(all.length).toBe(2);
    // The painite ring (priced, pristine, metallic, close) outranks the far depleted LTD.
    expect(all[0]?.commodityId).toBe("painite");
    const b = all[0]?.breakdown;
    expect(b?.score).toBe(all[0]?.score);
    // breakdown terms mirror scoreRing exactly: base = product, score = base − penalties.
    expect(b?.base).toBeCloseTo(
      (b?.price ?? 0) * (b?.overlapMultiplier ?? 0) * (b?.reserveWeight ?? 0) * (b?.ringMatch ?? 0),
    );
    expect(b?.score).toBeCloseTo(
      (b?.base ?? 0) - (b?.distancePenalty ?? 0) - (b?.sellLegPenalty ?? 0),
    );
  });

  it("surfaces overlap state (candidate = possible) + its commodities", () => {
    const painite = svc().candidates({ commodityId: "painite" }, ORIGIN, NOW)[0];
    expect(painite?.overlap).toBe("candidate");
    expect(painite?.overlapCommodities).toEqual(["painite", "platinum"]);
  });

  it("a confirmed overlap boosts the score (candidate does not)", () => {
    const before = svc().candidates({ commodityId: "painite" }, ORIGIN, NOW)[0]?.breakdown
      .overlapMultiplier;
    createOverlapRepository(db).record(
      { ringId: 1, commodities: ["painite", "platinum"], confidence: "confirmed" },
      "t",
    );
    const after = svc().candidates({ commodityId: "painite" }, ORIGIN, NOW)[0]?.breakdown
      .overlapMultiplier;
    expect(before).toBe(1); // candidate → no boost
    expect(after ?? 0).toBeGreaterThan(1); // confirmed → boost
  });

  it("filters compose: commodity + reserve + ring type + distance + pad", () => {
    expect(
      svc()
        .candidates({ reserve: "Pristine" }, ORIGIN, NOW)
        .map((c) => c.commodityId),
    ).toEqual(["painite"]);
    expect(
      svc()
        .candidates({ ringType: "Icy" }, ORIGIN, NOW)
        .map((c) => c.commodityId),
    ).toEqual(["lowtemperaturediamond"]);
    expect(
      svc()
        .candidates({ maxDistanceLy: 50 }, ORIGIN, NOW)
        .map((c) => c.systemName),
    ).toEqual(["Paesia"]);
    expect(
      svc()
        .candidates({ minPad: "L" }, ORIGIN, NOW)
        .map((c) => c.commodityId),
    ).toEqual(["painite"]); // only painite has a padded market
  });

  it("reports null distance when the commander's location is unknown", () => {
    const c = svc().candidates({ commodityId: "painite" }, undefined, NOW)[0];
    expect(c?.distanceLy).toBeNull();
  });

  it("carries provenance source + data-age timestamp", () => {
    const c = svc().candidates({ commodityId: "painite" }, ORIGIN, NOW)[0];
    expect(c?.source).toBe("journal");
    expect(c?.updatedAtMs).toBe(Date.parse("2025-06-01T00:00:00Z"));
  });
});
