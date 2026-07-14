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
import {
  DEFAULT_CARTOGRAPHER_OPTIONS,
  createCartographerBridge,
  emptyCartographerBridge,
} from "./cartographer-wiring.js";

const NOW = Date.parse("2025-06-01T12:00:00Z");

/** A mining system (Paesia) with a painite hotspot, and a sell system (Sol) with a market. */
function seed(db: Db): void {
  const sys = createSystemRepository(db);
  const paesia = sys.upsert({ name: "Paesia", x: 0, y: 0, z: 0 }, "t");
  sys.upsert({ name: "Sol", x: 30, y: 40, z: 0 }, "t"); // 50 ly from Paesia
  const bodyId = createBodyRepository(db).upsert({ systemId: paesia, name: "Paesia 2" }, "t");
  const ringId = createRingRepository(db).upsert({ bodyId, name: "Paesia 2 A Ring" }, "t");
  createHotspotRepository(db).record({ ringId, commodityId: "painite", count: 3 }, "t");
  db.prepare(
    `INSERT INTO market_snapshots (commodity_id, market_id, sell_price, source, source_ts, station_name, star_system)
     VALUES ('painite', 1, 800000, 'journal', '2025-06-01T12:00:00Z', 'Nemere', 'Sol')`,
  ).run();
}

const options = { ...DEFAULT_CARTOGRAPHER_OPTIONS, now: () => NOW };

describe("cartographer bridge", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    seed(db);
  });
  afterEach(() => db.close());

  it("builds a ranked plan from a hotspot ↔ its best sell station", async () => {
    const plans = await createCartographerBridge(db, options).plan("max-profit");
    expect(plans).toHaveLength(1);
    const plan = plans[0];
    expect(plan?.candidate).toMatchObject({
      commodityId: "painite",
      systemName: "Paesia",
      sellStation: "Nemere",
      sellSystem: "Sol",
      sellPrice: 800_000,
    });
    // Straight-line legs (Paesia ↔ Sol) present in both directions.
    expect(plan?.candidate.outboundLegs[0]).toMatchObject({ from: "Paesia", to: "Sol" });
    expect(plan?.candidate.returnLegs[0]).toMatchObject({ from: "Sol", to: "Paesia" });
    expect((plan?.estimatedCph ?? 0) > 0).toBe(true);
  });

  it("persists a planned run and returns its id", async () => {
    const bridge = createCartographerBridge(db, options);
    await bridge.plan("max-profit");
    const runId = bridge.save(0, "2025-06-01T00:00:00Z");
    expect(runId).not.toBeNull();
    const status = (
      db.prepare("SELECT status FROM runs WHERE id = ?").get(runId) as { status: string }
    ).status;
    expect(status).toBe("planned");
    expect(bridge.save(99, "t")).toBeNull(); // out-of-range index
  });

  it("skips hotspots with no known sell price (nothing to plan)", async () => {
    const bare = openDatabase(":memory:");
    applyMigrations(bare, MIGRATIONS);
    const sys = createSystemRepository(bare);
    const p = sys.upsert({ name: "Lonely", x: 0, y: 0, z: 0 }, "t");
    const b = createBodyRepository(bare).upsert({ systemId: p, name: "Lonely 1" }, "t");
    const r = createRingRepository(bare).upsert({ bodyId: b, name: "Lonely 1 A Ring" }, "t");
    createHotspotRepository(bare).record({ ringId: r, commodityId: "painite", count: 1 }, "t");
    // No market_snapshots → no sell price → no plannable run.
    expect(await createCartographerBridge(bare, options).plan("safest")).toEqual([]);
    bare.close();
  });

  it("empty bridge plans nothing and saves nothing", async () => {
    const e = emptyCartographerBridge();
    expect(await e.plan("max-profit")).toEqual([]);
    expect(e.save(0, "t")).toBeNull();
  });
});
