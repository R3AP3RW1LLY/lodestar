import { describe, expect, it } from "vitest";
import { createOutfitterBridge } from "./outfitter-wiring.js";
import type { CapturedLoadout } from "./outfitter-wiring.js";

const LASER_RIG: CapturedLoadout = {
  ship: "python",
  modules: [
    { slot: "Medium1", item: "Hpt_MiningLaser_Fixed_Medium" },
    { slot: "Slot01_Size4", item: "Int_Refinery_Size4_Class5" },
    { slot: "Slot02_Size3", item: "Int_DroneControl_Prospector_Size3_Class3" },
    { slot: "Slot03_Size3", item: "Int_DroneControl_Collection_Size3_Class3" },
  ],
};

describe("outfitter bridge", () => {
  it("reports no loadout before one is captured", () => {
    const advice = createOutfitterBridge(() => undefined).advise("laser");
    expect(advice).toMatchObject({ hasLoadout: false, ship: null, missingRequired: [] });
  });

  it("analyses the captured loadout for the chosen method", () => {
    const bridge = createOutfitterBridge(() => LASER_RIG);
    const laser = bridge.advise("laser");
    expect(laser).toMatchObject({ hasLoadout: true, ship: "python" });
    expect(laser.missingRequired).toEqual([]); // a full laser rig
    // The same rig lacks the deep-core essentials.
    const deepCore = bridge.advise("deep-core");
    expect(deepCore.missingRequired.map((g) => g.kind)).toContain("pwa");
  });
});
