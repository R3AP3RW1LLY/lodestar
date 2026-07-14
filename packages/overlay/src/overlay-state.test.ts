import { describe, expect, it } from "vitest";
import { envelope, initialRootState } from "@lodestar/shared";
import type { AssayVerdictEvent, RootState } from "@lodestar/shared";
import { cargoPercent, foldEnvelope, initialOverlayModel, topMaterial } from "./overlay-state.js";

const VERDICT: AssayVerdictEvent = {
  prospectId: 7,
  call: "MINE",
  score: 120_000,
  reasons: [{ code: "proportion-above-threshold", commodityId: "platinum" }],
  method: "laser",
  timestamp: "2025-06-01T12:00:00Z",
  content: "$AsteroidMaterialContent_High;",
  remainingPct: 100,
  materials: [
    { name: "platinum", displayName: "Platinum", proportion: 32 },
    { name: "gold", displayName: "Gold", proportion: 6 },
  ],
};

describe("foldEnvelope", () => {
  it("re-baselines the whole state on state.snapshot", () => {
    const snap: RootState = { ...initialRootState(), activity: "mining" };
    const next = foldEnvelope(initialOverlayModel(), envelope("state.snapshot", snap));
    expect(next.state.activity).toBe("mining");
  });

  it("applies a top-level-key delta over the current state", () => {
    const base = foldEnvelope(
      initialOverlayModel(),
      envelope("state.snapshot", { ...initialRootState(), activity: "mining" }),
    );
    const next = foldEnvelope(base, envelope("state.delta", { cargo: { count: 40, items: [] } }));
    expect(next.state.cargo.count).toBe(40);
    expect(next.state.activity).toBe("mining"); // untouched key preserved
  });

  it("replaces the shown verdict on assay.verdict", () => {
    const next = foldEnvelope(initialOverlayModel(), envelope("assay.verdict", VERDICT));
    expect(next.verdict?.call).toBe("MINE");
  });

  it("defaults to locked and updates locked on overlay.mode", () => {
    const model = initialOverlayModel();
    expect(model.locked).toBe(true);
    const unlocked = foldEnvelope(model, envelope("overlay.mode", { locked: false }));
    expect(unlocked.locked).toBe(false);
    const relocked = foldEnvelope(unlocked, envelope("overlay.mode", { locked: true }));
    expect(relocked.locked).toBe(true);
  });

  it("ignores channels the overlay does not display (e.g. session.stats)", () => {
    const model = initialOverlayModel();
    const next = foldEnvelope(model, envelope("session.stats", null));
    expect(next).toBe(model); // same reference — no-op
  });
});

describe("cargoPercent", () => {
  it("computes fill against capacity", () => {
    const state: RootState = {
      ...initialRootState(),
      ship: { cargoCapacity: 256 },
      cargo: { count: 128, items: [] },
    };
    expect(cargoPercent(state)).toBeCloseTo(50);
  });

  it("is undefined when capacity is unknown or non-positive", () => {
    expect(cargoPercent(initialRootState())).toBeUndefined();
    expect(cargoPercent({ ...initialRootState(), ship: { cargoCapacity: 0 } })).toBeUndefined();
  });

  it("clamps an overfull hold to 100", () => {
    const state: RootState = {
      ...initialRootState(),
      ship: { cargoCapacity: 100 },
      cargo: { count: 140, items: [] },
    };
    expect(cargoPercent(state)).toBe(100);
  });
});

describe("topMaterial", () => {
  it("returns the highest-proportion material", () => {
    expect(topMaterial(VERDICT.materials)?.name).toBe("platinum");
  });

  it("returns undefined for no materials", () => {
    expect(topMaterial([])).toBeUndefined();
  });
});
