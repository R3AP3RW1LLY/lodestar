import { test, expect, _electron as electron } from "@playwright/test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";

const APP_ENTRY = join(import.meta.dirname, "..", "out", "main", "index.cjs");
const JOURNAL = "Journal.2025-06-01T120000.01.log";

// An active mining session: python at a ring, 2t painite refined, hold known.
const INITIAL =
  [
    `{"timestamp":"2025-06-01T12:00:00Z","event":"LoadGame","Commander":"CMDR_E2E","FID":"F0","Ship":"python","ShipName":"S"}`,
    `{"timestamp":"2025-06-01T12:00:05Z","event":"SupercruiseExit","StarSystem":"Paesia","Body":"Paesia 2 A Ring","BodyType":"PlanetaryRing"}`,
    `{"timestamp":"2025-06-01T12:00:10Z","event":"LaunchDrone","Type":"Prospector"}`,
    `{"timestamp":"2025-06-01T12:01:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
    `{"timestamp":"2025-06-01T12:02:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
    `{"timestamp":"2025-06-01T12:03:00Z","event":"Cargo","Vessel":"Ship","Count":2,"Inventory":[{"Name":"painite","Count":2,"Stolen":0}]}`,
  ].join("\n") + "\n";

// Live continuation: dock at a station and sell the hold → the session ends.
const CONTINUATION =
  [
    `{"timestamp":"2025-06-01T12:05:00Z","event":"Docked","StationName":"Coriolis Demo","StationType":"Coriolis","StarSystem":"Paesia","SystemAddress":1,"MarketID":2}`,
    `{"timestamp":"2025-06-01T12:06:00Z","event":"MarketSell","MarketID":2,"Type":"painite","Count":2,"SellPrice":1,"TotalSale":1000000,"AvgPricePaid":0}`,
  ].join("\n") + "\n";

let dataDir: string;
let journalDir: string;

test.beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "lodestar-telemetry-data-"));
  journalDir = mkdtempSync(join(tmpdir(), "lodestar-telemetry-journal-"));
});

test.afterEach(() => {
  for (const dir of [dataDir, journalDir]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch {
      // Best-effort teardown.
    }
  }
});

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [APP_ENTRY],
    env: { ...process.env, LODESTAR_DATA_DIR: dataDir, LODESTAR_JOURNAL_DIR: journalDir },
  });
}

/**
 * Phase-1 acceptance: main emits → renderer store updates. This drives the REAL
 * pipeline and observes the REAL Command Deck: the engine folds the journal, the
 * state bridge pushes snapshot + deltas + session.stats over IPC, the store
 * applies them, and the panels re-render. The snapshot proves the initial state
 * reaches the UI; a live journal APPEND proves state.delta (a new station in the
 * Location panel) and session.stats (active → ended) reach it too.
 */
test("live journal telemetry drives the Command Deck panels", async () => {
  writeFileSync(join(journalDir, JOURNAL), INITIAL);

  const app = await launch();
  const win = await app.firstWindow();

  // Snapshot → UI: the active mining session and its context render.
  await expect(win.getByTestId("session-status")).toHaveText("active", { timeout: 15000 });
  await expect(win.getByTestId("activity-value")).toHaveText("Mining");
  await expect(win.getByText("Paesia", { exact: true })).toBeVisible();

  // Live append → dock + sell. state.delta lands the station in the Location panel;
  // session.stats flips the session to ended — both pushed over IPC to the store.
  appendFileSync(join(journalDir, JOURNAL), CONTINUATION);

  try {
    await expect(win.getByText("Coriolis Demo")).toBeVisible({ timeout: 15000 }); // state.delta
    await expect(win.getByTestId("session-status")).toHaveText("ended", { timeout: 15000 }); // session.stats
  } finally {
    await app.close();
  }
});
