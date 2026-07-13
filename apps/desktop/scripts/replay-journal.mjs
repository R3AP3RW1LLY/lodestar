/**
 * Fixture journal replay for the Phase-1 live demo / manual verification
 * (SSOT Step 1.10). Writes a realistic mining session into a target journal dir
 * with REAL-TIME timestamps, so the running Command Deck shows a LIVE badge and
 * session rates climbing. Not product code — a dev/verification driver.
 *
 * Usage:  node apps/desktop/scripts/replay-journal.mjs <journalDir>
 * Ctrl+C to stop; the deck then flips to GAME OFFLINE over the last-known snapshot.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (dir === undefined) {
  console.error("usage: node apps/desktop/scripts/replay-journal.mjs <journalDir>");
  process.exit(2);
}
mkdirSync(dir, { recursive: true });

const journal = join(dir, "Journal.2025-06-01T120000.01.log");
const statusPath = join(dir, "Status.json");
writeFileSync(journal, "", "utf8"); // fresh session

const iso = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emit = (event) => {
  appendFileSync(journal, JSON.stringify({ timestamp: iso(), ...event }) + "\n", "utf8");
  console.log("journal>", event.event);
};
// Mining loadout: hardpoints deployed, in main ship (real capture 16777288); pips 2/4/0.
const status = (cargo) =>
  writeFileSync(
    statusPath,
    JSON.stringify({
      timestamp: iso(),
      event: "Status",
      Flags: 16777288,
      Flags2: 0,
      Pips: [4, 8, 0],
      Fuel: { FuelMain: 29.89, FuelReservoir: 0.42 },
      Cargo: cargo,
    }),
    "utf8",
  );

const RING = "Hyades Sector DR-V c2-23 A Ring";

async function main() {
  emit({
    event: "LoadGame",
    Commander: "CMDR_DEMO",
    FID: "F0000000",
    Ship: "python",
    ShipName: "LODESTAR DEMO",
    ShipIdent: "LS-99",
    GameMode: "Solo",
  });
  emit({
    event: "Loadout",
    Ship: "python",
    ShipName: "LODESTAR DEMO",
    ShipIdent: "LS-99",
    CargoCapacity: 256,
    MaxJumpRange: 22.55,
    Modules: [
      { Slot: "MediumHardpoint1", Item: "hpt_mining_abrblstr_fixed_medium" },
      { Slot: "Slot01_Size6", Item: "int_cargorack_size6_class1" },
    ],
  });
  emit({
    event: "Location",
    StarSystem: "Hyades Sector DR-V c2-23",
    SystemAddress: 1,
    StarPos: [1, 2, 3],
    Docked: false,
    Body: "Hyades Sector DR-V c2-23 A 2",
    BodyType: "Planet",
  });
  emit({
    event: "SupercruiseExit",
    StarSystem: "Hyades Sector DR-V c2-23",
    Body: RING,
    BodyType: "PlanetaryRing",
  });
  status(0);

  let cargo = 0;
  const commodities = ["painite", "platinum", "osmium"];
  console.log("\n▶ mining — watch the Command Deck. Ctrl+C to stop.\n");
  // Continuous mining arc: prospect, then refine a few tons, update cargo. Repeat.
  for (let cycle = 0; ; cycle++) {
    emit({ event: "LaunchDrone", Type: "Prospector" });
    await sleep(1200);
    emit({
      event: "ProspectedAsteroid",
      Materials: [{ Name: "painite", Proportion: 25 }],
      Content: "$AsteroidMaterialContent_High;",
      Remaining: 100,
    });
    await sleep(800);
    const commodity = commodities[cycle % commodities.length];
    for (let i = 0; i < 3; i++) {
      emit({ event: "MiningRefined", Type: `$${commodity}_name;` });
      cargo += 1;
      const inventory = [{ Name: commodity, Count: cargo, Stolen: 0 }];
      emit({ event: "Cargo", Vessel: "Ship", Count: cargo, Inventory: inventory });
      status(cargo);
      await sleep(1500);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
