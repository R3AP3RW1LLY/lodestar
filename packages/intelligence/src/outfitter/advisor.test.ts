import { describe, expect, it } from "vitest";
import { analyzeLoadout } from "./advisor.js";
import type { LoadoutModule, ShipSlots } from "./advisor.js";
import { METHOD_TEMPLATES, detectModule } from "./templates.js";
import type { MiningMethod } from "@lodestar/shared";

const mod = (item: string): LoadoutModule => ({ slot: "x", item });

const ITEMS = {
  laser: "Hpt_MiningLaser_Fixed_Medium",
  pwa: "Hpt_MRAScanner_Size0_Class5",
  seismic: "Hpt_Mining_SeismChrgWarhd_Fixed_Medium",
  subsurface: "Hpt_Mining_SubSurfDispMisl_Fixed_Medium",
  abrasion: "Hpt_Mining_AbrBlstr_Fixed_Small",
  prospector: "Int_DroneControl_Prospector_Size3_Class3",
  collector: "Int_DroneControl_Collection_Size3_Class3",
  refinery: "Int_Refinery_Size4_Class5",
};

const BIG_SHIP: ShipSlots = { hardpoints: [1, 2, 3], optionalInternals: [3, 4, 5, 6] };

describe("detectModule", () => {
  it.each([
    [ITEMS.laser, "mining-laser"],
    [ITEMS.pwa, "pwa"],
    [ITEMS.seismic, "seismic-launcher"],
    [ITEMS.subsurface, "subsurface-missile"],
    [ITEMS.prospector, "prospector-controller"],
    [ITEMS.refinery, "refinery"],
  ])("identifies %s → %s", (item, kind) => {
    expect(detectModule(item)?.kind).toBe(kind);
  });

  it("returns undefined for a non-mining module", () => {
    expect(detectModule("Hpt_PulseLaser_Fixed_Small")).toBeUndefined();
  });
});

describe("analyzeLoadout — gap analysis across all three methods", () => {
  const methods: MiningMethod[] = ["laser", "deep-core", "subsurface"];

  it.each(methods)("an empty loadout is missing every required module for %s", (method) => {
    const advice = analyzeLoadout([], method);
    expect(advice.missingRequired.map((g) => g.kind).sort()).toEqual(
      [...METHOD_TEMPLATES[method].required].map((s) => s.kind).sort(),
    );
    expect(advice.present).toEqual([]);
  });

  it("a fully-equipped deep-core rig reports no required gaps + lists what's present", () => {
    const advice = analyzeLoadout(
      [ITEMS.seismic, ITEMS.pwa, ITEMS.refinery, ITEMS.collector, ITEMS.prospector].map(mod),
      "deep-core",
    );
    expect(advice.missingRequired).toEqual([]);
    expect(advice.present.map((m) => m.kind)).toContain("pwa");
  });

  it("a laser rig lacks the deep-core essentials (PWA + seismic launcher)", () => {
    const advice = analyzeLoadout(
      [ITEMS.laser, ITEMS.refinery, ITEMS.collector].map(mod),
      "deep-core",
    );
    const missing = advice.missingRequired.map((g) => g.kind);
    expect(missing).toContain("pwa");
    expect(missing).toContain("seismic-launcher");
    expect(advice.missingRequired.find((g) => g.kind === "pwa")?.reason).toBe(
      "required for deep-core",
    );
  });

  it("a laser rig needs a sub-surface missile for the subsurface method", () => {
    const advice = analyzeLoadout(
      [ITEMS.laser, ITEMS.refinery, ITEMS.collector].map(mod),
      "subsurface",
    );
    expect(advice.missingRequired.map((g) => g.kind)).toContain("subsurface-missile");
  });
});

describe("analyzeLoadout — recommendations respect the ship's slots", () => {
  it("never suggests a hardpoint module the ship has no room for", () => {
    // A ship with NO hardpoints: the recommended abrasion blaster (hardpoint) must be dropped.
    const noHardpoints: ShipSlots = { hardpoints: [], optionalInternals: [4, 5] };
    const advice = analyzeLoadout(
      [ITEMS.laser, ITEMS.refinery, ITEMS.prospector, ITEMS.collector].map(mod),
      "laser",
      noHardpoints,
    );
    expect(advice.suggestions.map((s) => s.kind)).not.toContain("abrasion-blaster");
  });

  it("suggests a fitting recommended module and flags a required module that won't fit", () => {
    const advice = analyzeLoadout([ITEMS.refinery, ITEMS.collector].map(mod), "laser", BIG_SHIP);
    // mining-laser is required + missing; the big ship fits it.
    expect(advice.missingRequired.find((g) => g.kind === "mining-laser")?.fitsShip).toBe(true);
    // abrasion blaster (recommended) fits BIG_SHIP → suggested.
    expect(advice.suggestions.map((s) => s.kind)).toContain("abrasion-blaster");
  });

  it("required gaps are ALWAYS reported (with fitsShip=false) so an impossible fit is visible", () => {
    const noHardpoints: ShipSlots = { hardpoints: [], optionalInternals: [4] };
    const advice = analyzeLoadout([], "laser", noHardpoints);
    const laserGap = advice.missingRequired.find((g) => g.kind === "mining-laser");
    expect(laserGap).toBeDefined();
    expect(laserGap?.fitsShip).toBe(false); // no hardpoint → doesn't fit, but still surfaced
  });

  it("does not filter suggestions when ship slots are unknown", () => {
    const advice = analyzeLoadout(
      [ITEMS.laser, ITEMS.refinery, ITEMS.prospector, ITEMS.collector].map(mod),
      "laser",
    );
    expect(advice.suggestions.map((s) => s.kind)).toContain("abrasion-blaster");
  });
});
