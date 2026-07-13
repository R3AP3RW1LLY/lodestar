import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";

const APP_ENTRY = join(import.meta.dirname, "..", "out", "main", "index.cjs");

// A minimal mining session written into the watched journal dir AFTER launch, so
// the live engine picks it up, folds it, and the state bridge pushes the result.
const JOURNAL_LINES = [
  `{"timestamp":"2025-06-01T12:00:00Z","event":"LoadGame","Commander":"CMDR_E2E","FID":"F0","Ship":"python","ShipName":"S"}`,
  `{"timestamp":"2025-06-01T12:00:05Z","event":"SupercruiseExit","StarSystem":"Paesia","Body":"Paesia 2 A Ring","BodyType":"PlanetaryRing"}`,
  `{"timestamp":"2025-06-01T12:00:10Z","event":"LaunchDrone","Type":"Prospector"}`,
  `{"timestamp":"2025-06-01T12:01:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
  `{"timestamp":"2025-06-01T12:02:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
];

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
      // Best-effort teardown — Windows may briefly hold the handle past close.
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
 * Phase-1 acceptance: "main emits → renderer store updates." This drives the REAL
 * IPC + WS state bridge: the renderer subscribes (getStateSnapshot + push
 * listeners), a journal file is written into the watched dir, and the renderer
 * observes the throttled session.stats / state.delta pushes reflect the mining.
 */
test("live journal events flow through the engine and bridge to the renderer", async () => {
  const app = await launch();
  const win = await app.firstWindow();

  // Attach push listeners and hydrate the baseline BEFORE any journal is written.
  await win.evaluate(async () => {
    const w = window as unknown as {
      lodestar: {
        getStateSnapshot: () => Promise<unknown>;
        onStateDelta: (cb: (d: unknown) => void) => void;
        onSessionStats: (cb: (s: unknown) => void) => void;
      };
      __deltas: unknown[];
      __sessions: unknown[];
    };
    w.__deltas = [];
    w.__sessions = [];
    w.lodestar.onStateDelta((d) => w.__deltas.push(d));
    w.lodestar.onSessionStats((s) => w.__sessions.push(s));
    await w.lodestar.getStateSnapshot();
  });

  // Now write the journal — the watcher (100 ms poll) picks it up and the engine
  // folds it into an active session, which the bridge pushes to the renderer. The
  // trailing newline matters: the tailer only emits newline-terminated lines (as
  // the real game always writes), so without it the last event would be withheld.
  writeFileSync(
    join(journalDir, "Journal.2025-06-01T120000.01.log"),
    JOURNAL_LINES.join("\n") + "\n",
  );

  await win.waitForFunction(
    () => {
      const sessions = (window as unknown as { __sessions: { tonsRefined?: number }[] }).__sessions;
      const last = sessions.at(-1);
      return last !== undefined && last !== null && (last.tonsRefined ?? 0) >= 2;
    },
    undefined,
    { timeout: 15000 },
  );

  const result = await win.evaluate(() => {
    const w = window as unknown as {
      __deltas: unknown[];
      __sessions: { tonsRefined: number; active: boolean }[];
    };
    return { lastSession: w.__sessions.at(-1), deltaCount: w.__deltas.length };
  });

  try {
    expect(result.lastSession?.tonsRefined).toBe(2);
    expect(result.lastSession?.active).toBe(true);
    expect(result.deltaCount).toBeGreaterThan(0); // state deltas flowed too
  } finally {
    await app.close();
  }
});
