import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import electronPath from "electron";
import type { ElectronApplication } from "@playwright/test";
import { mainWindow } from "./helpers.js";

const APP_DIR = join(import.meta.dirname, "..");
const APP_ENTRY = join(APP_DIR, "out", "main", "index.cjs");

let dataDir: string;

test.beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "lodestar-e2e-"));
});

test.afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

test("boots to the Command Deck shell and renders the IPC health payload", async () => {
  const app: ElectronApplication = await electron.launch({
    args: [APP_ENTRY],
    env: { ...process.env, LODESTAR_DATA_DIR: dataDir },
  });
  try {
    const window = await mainWindow(app);
    await expect(window.getByRole("heading", { name: /command deck/i })).toBeVisible();
    // The status bar reflects real probes: the profile DB is opened and migrated
    // at boot → status ok (Step 0.6); no journal configured yet.
    await expect(window.getByTestId("status-db")).toHaveAttribute("data-status", "ok");
    await expect(window.getByTestId("status-journal")).toHaveAttribute(
      "data-status",
      "not-configured",
    );
    // The migrated SQLite file exists on the D-drive data dir.
    expect(existsSync(join(dataDir, "lodestar.sqlite3"))).toBe(true);
    // The logger wrote a rotating log file into the D-drive data dir, not C:.
    const logsDir = join(dataDir, "logs");
    expect(existsSync(logsDir)).toBe(true);
    expect(readdirSync(logsDir).some((f) => f.endsWith(".log"))).toBe(true);
  } finally {
    await app.close();
  }
});

test("a second instance quits on its own and opens no second window (single-instance lock)", async () => {
  const first = await electron.launch({
    args: [APP_ENTRY],
    env: { ...process.env, LODESTAR_DATA_DIR: dataDir },
  });
  try {
    await mainWindow(first);
    // The app opens two windows — the Command Deck and the hidden Step-2.10
    // overlay — and the overlay loads asynchronously, so wait for BOTH to settle
    // before we prove the BLOCKED second instance adds none of its own.
    await expect.poll(() => first.windows().length).toBe(2);
    // Launch the second instance as a raw process (Playwright's launcher would
    // reject an app that deliberately never shows a window). It shares the same
    // data dir, so it fails to acquire the lock and must quit on its own.
    const second = spawn(electronPath as unknown as string, ["."], {
      cwd: APP_DIR,
      env: { ...process.env, LODESTAR_DATA_DIR: dataDir },
    });
    let stdout = "";
    second.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    const exitCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        second.kill();
        reject(new Error("second instance did not quit within 15s — lock not enforced"));
      }, 15_000);
      second.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code ?? -1);
      });
    });
    // It must quit cleanly AND for the right reason (lock denial, not a crash).
    expect(exitCode).toBe(0);
    expect(stdout).toContain("LODESTAR_SECOND_INSTANCE_QUIT");
    // The blocked instance added no window — the first instance still has exactly
    // its own two (Command Deck + overlay).
    expect(first.windows().length).toBe(2);
  } finally {
    await first.close();
  }
});
