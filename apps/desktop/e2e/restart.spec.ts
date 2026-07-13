import { test, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";

const APP_ENTRY = join(import.meta.dirname, "..", "out", "main", "index.cjs");
const JOURNAL = "Journal.2025-06-01T120000.01.log";

// An ACTIVE (unsold) mining session → tonsRefined 2, session stays open.
const ACTIVE_SESSION =
  [
    `{"timestamp":"2025-06-01T12:00:00Z","event":"LoadGame","Commander":"CMDR_E2E","FID":"F0","Ship":"python","ShipName":"S"}`,
    `{"timestamp":"2025-06-01T12:00:05Z","event":"SupercruiseExit","StarSystem":"Paesia","Body":"Paesia 2 A Ring","BodyType":"PlanetaryRing"}`,
    `{"timestamp":"2025-06-01T12:00:10Z","event":"LaunchDrone","Type":"Prospector"}`,
    `{"timestamp":"2025-06-01T12:01:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
    `{"timestamp":"2025-06-01T12:02:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
  ].join("\n") + "\n";

let dataDir: string;
let journalDir: string;

test.beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "lodestar-restart-data-"));
  journalDir = mkdtempSync(join(tmpdir(), "lodestar-restart-journal-"));
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

/** Subscribe to session pushes and hydrate; resolves once wired. */
async function subscribe(win: Page): Promise<void> {
  await win.evaluate(async () => {
    const w = window as unknown as {
      lodestar: {
        getStateSnapshot: () => Promise<unknown>;
        onSessionStats: (cb: (s: unknown) => void) => void;
      };
      __sessions: unknown[];
    };
    w.__sessions = [];
    w.lodestar.onSessionStats((s) => w.__sessions.push(s));
    await w.lodestar.getStateSnapshot();
  });
}

async function waitForTons(win: Page, tons: number): Promise<void> {
  await win.waitForFunction(
    (t: number) => {
      const sessions = (window as unknown as { __sessions: { tonsRefined?: number }[] }).__sessions;
      const last = sessions.at(-1);
      return last != null && last.tonsRefined === t;
    },
    tons,
    { timeout: 15000 },
  );
}

/**
 * Step 1.9a acceptance: a real app restart mid-session must RESUME the session
 * (not reset) and must NOT re-fold the already-consumed journal (which would
 * double the totals / orphan the row). We assert the continued total is exactly
 * 2 → +1 = 3 across the restart, which only holds if the cursor + loadActive work.
 */
test("an app restart mid-session resumes totals without re-folding the journal", async () => {
  writeFileSync(join(journalDir, JOURNAL), ACTIVE_SESSION);

  const first = await launch();
  const w1 = await first.firstWindow();
  await subscribe(w1);
  await waitForTons(w1, 2); // folded the active session; cursor persisted
  await first.close();

  // Relaunch on the SAME data dir (cursor + DB) and journal dir.
  const second = await launch();
  const w2 = await second.firstWindow();
  await subscribe(w2);
  await waitForTons(w2, 2); // resumed from the DB — NOT re-folded (would be 4)

  // One more refine after the restart accumulates onto the same session.
  appendFileSync(
    join(journalDir, JOURNAL),
    `{"timestamp":"2025-06-01T12:10:00Z","event":"MiningRefined","Type":"$painite_name;"}\n`,
  );
  try {
    await waitForTons(w2, 3); // 2 (resumed) + 1 — not 5, not reset to 1
  } finally {
    await second.close();
  }
});
