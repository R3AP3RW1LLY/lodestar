import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createThresholdOverridesStore } from "./threshold-overrides.js";

describe("threshold overrides store", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
  });
  afterEach(() => {
    db.close();
  });

  it("persists and lists a valid override", () => {
    const store = createThresholdOverridesStore(db);
    expect(store.set({ commodityId: "painite", method: "laser", minProportion: 40 }).ok).toBe(true);
    expect(store.list()).toEqual([{ commodityId: "painite", method: "laser", minProportion: 40 }]);
  });

  it("a second store over the same DB reads the persisted override (round-trip)", () => {
    createThresholdOverridesStore(db).set({
      commodityId: "platinum",
      method: "subsurface",
      minProportion: 30,
    });
    expect(createThresholdOverridesStore(db).list()).toEqual([
      { commodityId: "platinum", method: "subsurface", minProportion: 30 },
    ]);
  });

  it("replaces (not duplicates) an override for the same commodity×method", () => {
    const store = createThresholdOverridesStore(db);
    store.set({ commodityId: "painite", method: "laser", minProportion: 40 });
    store.set({ commodityId: "painite", method: "laser", minProportion: 55 });
    expect(store.list()).toEqual([{ commodityId: "painite", method: "laser", minProportion: 55 }]);
  });

  it("rejects invalid overrides and does not persist them", () => {
    const store = createThresholdOverridesStore(db);
    const unknown = store.set({ commodityId: "unobtanium", method: "laser", minProportion: 20 });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe("threshold.unknown-commodity");

    const badMethod = store.set({
      commodityId: "painite",
      method: "plasma" as never,
      minProportion: 20,
    });
    expect(badMethod.ok).toBe(false);

    for (const bad of [-1, 101, Number.NaN]) {
      expect(store.set({ commodityId: "painite", method: "laser", minProportion: bad }).ok).toBe(
        false,
      );
    }
    expect(store.list()).toEqual([]); // nothing invalid was persisted
  });

  it("clears an override", () => {
    const store = createThresholdOverridesStore(db);
    store.set({ commodityId: "painite", method: "laser", minProportion: 40 });
    store.set({ commodityId: "opal", method: "deep-core", minProportion: 10 });
    store.clear("painite", "laser");
    expect(store.list()).toEqual([{ commodityId: "opal", method: "deep-core", minProportion: 10 }]);
  });

  it("reads a corrupt stored value as empty (never crashes)", () => {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('assay.threshold-overrides', 'not json')",
    ).run();
    expect(createThresholdOverridesStore(db).list()).toEqual([]);
  });

  it("drops structurally-invalid entries from a tampered array (shape + null)", () => {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('assay.threshold-overrides',
        '[{"commodityId":"painite","method":"laser","minProportion":40},{"bogus":true},null]')`,
    ).run();
    expect(createThresholdOverridesStore(db).list()).toEqual([
      { commodityId: "painite", method: "laser", minProportion: 40 },
    ]);
  });

  it("drops SEMANTICALLY-invalid tampered rows (unknown commodity / out-of-range %)", () => {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('assay.threshold-overrides',
        '[{"commodityId":"unobtanium","method":"laser","minProportion":50},
          {"commodityId":"painite","method":"laser","minProportion":999},
          {"commodityId":"opal","method":"deep-core","minProportion":10}]')`,
    ).run();
    // Only the valid one survives — a tampered DB can't inject a live bad override.
    expect(createThresholdOverridesStore(db).list()).toEqual([
      { commodityId: "opal", method: "deep-core", minProportion: 10 },
    ]);
  });

  it("reads a non-array JSON value as empty", () => {
    db.prepare(
      "INSERT INTO settings (key, value) VALUES ('assay.threshold-overrides', '{}')",
    ).run();
    expect(createThresholdOverridesStore(db).list()).toEqual([]);
  });
});
