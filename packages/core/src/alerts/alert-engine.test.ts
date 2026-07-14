import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, MIGRATIONS, openDatabase } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createAlertEngine } from "./alert-engine.js";
import type { FiredAlert } from "./alert-engine.js";

const iso = (min: number): string => new Date(Date.UTC(2025, 5, 1, 0, min)).toISOString();

describe("alert engine", () => {
  let db: Db;
  let fired: FiredAlert[];
  const engine = () => createAlertEngine(db, (a) => fired.push(a));

  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    fired = [];
  });
  afterEach(() => db.close());

  it("stores + lists + enables/disables + deletes rules", () => {
    const e = engine();
    const id = e.addRule(
      {
        kind: "price-threshold",
        commodityId: "painite",
        threshold: 500_000,
        label: "Painite 500k",
      },
      iso(0),
    );
    expect(e.listRules()[0]).toMatchObject({
      id,
      kind: "price-threshold",
      commodityId: "painite",
      threshold: 500_000,
      direction: "above",
      enabled: true,
    });
    e.setEnabled(id, false);
    expect(e.listRules()[0]?.enabled).toBe(false);
    e.deleteRule(id);
    expect(e.listRules()).toEqual([]);
  });

  it("fires exactly once per crossing (edge-triggered, re-arms after leaving the zone)", () => {
    const e = engine();
    e.addRule({ kind: "price-threshold", commodityId: "painite", threshold: 500_000 }, iso(0));
    expect(e.evaluatePrice("painite", 400_000, iso(1))).toHaveLength(0); // below
    expect(e.evaluatePrice("painite", 550_000, iso(2))).toHaveLength(1); // crossing up → fire
    expect(e.evaluatePrice("painite", 600_000, iso(3))).toHaveLength(0); // still above → no re-fire
    expect(e.evaluatePrice("painite", 450_000, iso(4))).toHaveLength(0); // back below → re-arm
    expect(e.evaluatePrice("painite", 520_000, iso(5))).toHaveLength(1); // new crossing → fire
    expect(fired).toHaveLength(2);
  });

  it("only evaluates rules for the matching commodity", () => {
    const e = engine();
    e.addRule({ kind: "price-threshold", commodityId: "painite", threshold: 500_000 }, iso(0));
    expect(e.evaluatePrice("platinum", 999_999, iso(1))).toHaveLength(0);
  });

  it("honors a per-rule cooldown across crossings", () => {
    const e = engine();
    e.addRule(
      {
        kind: "price-threshold",
        commodityId: "painite",
        threshold: 500_000,
        cooldownMs: 10 * 60_000,
      },
      iso(0),
    );
    expect(e.evaluatePrice("painite", 550_000, iso(1))).toHaveLength(1); // fire @ 1 min
    e.evaluatePrice("painite", 400_000, iso(2)); // re-arm
    expect(e.evaluatePrice("painite", 550_000, iso(5))).toHaveLength(0); // crossing within cooldown → throttled
    e.evaluatePrice("painite", 400_000, iso(6)); // re-arm
    expect(e.evaluatePrice("painite", 550_000, iso(20))).toHaveLength(1); // cooldown elapsed → fire
  });

  it("supports a 'below' direction (price drop alert)", () => {
    const e = engine();
    e.addRule(
      { kind: "price-threshold", commodityId: "painite", threshold: 300_000, direction: "below" },
      iso(0),
    );
    expect(e.evaluatePrice("painite", 400_000, iso(1))).toHaveLength(0); // above
    expect(e.evaluatePrice("painite", 250_000, iso(2))).toHaveLength(1); // dropped below → fire
  });

  it("fires a cargo-full alert at the configured fill %", () => {
    const e = engine();
    e.addRule({ kind: "cargo-full", threshold: 80, label: "Sell leg" }, iso(0));
    expect(e.evaluateCargo(75, iso(1))).toHaveLength(0); // below
    const fires = e.evaluateCargo(85, iso(2)); // reached the fill % → fire
    expect(fires).toHaveLength(1);
    expect(fires[0]).toMatchObject({ kind: "cargo-full", threshold: 80, value: 85 });
    expect(e.evaluateCargo(90, iso(3))).toHaveLength(0); // still full → no re-fire
  });

  it("a disabled rule never fires", () => {
    const e = engine();
    const id = e.addRule({ kind: "cargo-full", threshold: 80 }, iso(0));
    e.setEnabled(id, false);
    expect(e.evaluateCargo(95, iso(1))).toHaveLength(0);
  });

  it("hands each fire to the emit sink (notification + TTS delivery point)", () => {
    const emit = vi.fn();
    const e = createAlertEngine(db, emit);
    e.addRule({ kind: "cargo-full", threshold: 80 }, iso(0));
    e.evaluateCargo(85, iso(1));
    expect(emit).toHaveBeenCalledOnce();
  });
});
