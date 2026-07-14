import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, MIGRATIONS, openDatabase } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { isOk } from "@lodestar/shared";
import { createPlanService, straightLineRouteProvider } from "./plan-service.js";
import type { PlanRequest, RouteProvider } from "./plan-service.js";

const INPUT = { cargoCapacity: 256, secondsPerJump: 45 };

const request = (over: Partial<PlanRequest> = {}): PlanRequest => ({
  ringName: "Paesia 2 A Ring",
  commodityId: "painite",
  miningSystem: { name: "Paesia", x: 0, y: 0, z: 0 },
  hotspotScore: 500_000,
  miningTph: 200,
  sellStation: "Nemere Terminal",
  sellSystem: { name: "Sol", x: 30, y: 40, z: 0 }, // 50 ly away
  sellPrice: 500_000,
  ...over,
});

describe("straightLineRouteProvider", () => {
  it("computes distance + jumps = ceil(distance / range)", async () => {
    const r = await straightLineRouteProvider(20).route(
      { name: "A", x: 0, y: 0, z: 0 },
      { name: "B", x: 30, y: 40, z: 0 },
    );
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.legs[0]).toMatchObject({ from: "A", to: "B", distanceLy: 50, jumps: 3 }); // 50/20 → 3
    expect(r.value.minSecurity).toBe(0.5);
  });

  it("is 0 jumps for a same-system route", async () => {
    const r = await straightLineRouteProvider(20).route(
      { name: "A", x: 1, y: 2, z: 3 },
      { name: "A", x: 1, y: 2, z: 3 },
    );
    expect(isOk(r) && r.value.legs[0]?.jumps).toBe(0);
  });
});

describe("plan service", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
  });
  afterEach(() => db.close());

  it("plans ranked runs using the injected route provider", async () => {
    const svc = createPlanService(db, straightLineRouteProvider(25));
    const result = await svc.planRuns(
      [
        request({ ringName: "Rich", sellPrice: 900_000 }),
        request({ ringName: "Poor", sellPrice: 300_000 }),
      ],
      INPUT,
      "max-profit",
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    expect(result.value[0]?.candidate.ringName).toBe("Rich"); // higher price → higher cph
    // The outbound legs came from the provider; the return legs are the reverse.
    expect(result.value[0]?.candidate.returnLegs[0]).toMatchObject({ from: "Sol", to: "Paesia" });
  });

  it("propagates a route-provider failure", async () => {
    const failing: RouteProvider = {
      route: () =>
        Promise.resolve({
          ok: false as const,
          error: { code: "spansh/timeout", message: "no route" },
        }),
    };
    const result = await createPlanService(db, failing).planRuns([request()], INPUT, "max-profit");
    expect(isOk(result)).toBe(false);
  });

  it("persists a plan to runs with its estimates", async () => {
    const svc = createPlanService(db, straightLineRouteProvider(25));
    const result = await svc.planRuns([request()], INPUT, "max-profit");
    if (!isOk(result)) throw new Error("plan failed");
    const plan = result.value[0];
    if (plan === undefined) throw new Error("no plan");
    const id = svc.savePlan(plan, "2025-06-01T00:00:00Z");
    const row = db
      .prepare("SELECT plan, estimated_tph, estimated_cph, status FROM runs WHERE id = ?")
      .get(id) as {
      plan: string;
      estimated_tph: number;
      estimated_cph: number;
      status: string;
    };
    expect(row.status).toBe("planned");
    expect(row.estimated_cph).toBeCloseTo(plan.estimatedCph);
    expect(JSON.parse(row.plan)).toMatchObject({ candidate: { ringName: "Paesia 2 A Ring" } });
  });

  it("routes through the injected provider (spy)", async () => {
    const spy = vi.fn(straightLineRouteProvider(25).route);
    const svc = createPlanService(db, { route: spy });
    await svc.planRuns([request()], INPUT, "safest");
    expect(spy).toHaveBeenCalledOnce();
  });
});
