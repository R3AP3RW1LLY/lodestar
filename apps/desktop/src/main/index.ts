/**
 * Electron main entry (SSOT Step 0.4). Enforces single-instance, redirects all
 * runtime data to the configured data dir (D: on this machine per the operator
 * constraint), wires the pino logger, registers typed IPC, and boots the
 * Command Deck window.
 */

import { app, dialog, ipcMain, BrowserWindow } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { APP_VERSION } from "@lodestar/shared";
import type { Logger } from "@lodestar/shared";
import { createDbService, createSettingsService, createSecretsStore } from "@lodestar/core";
import type { DbService } from "@lodestar/core";
import { safeStorageBackend, fileSecretStorage } from "./secrets.js";
import { createSettingsBridge } from "./settings-bridge.js";
import type { SettingsBridge } from "./settings-bridge.js";
import { listGpus } from "./gpu.js";
import { acquireSingleInstance } from "./app-lifecycle.js";
import { createMainWindow } from "./windows.js";
import { electronIpcAdapter, registerIpcHandlers } from "./ipc.js";
import { buildHealth } from "./health.js";
import { createLogger, createRollingDestination } from "./logger.js";
import { getDataDir, getLogsDir } from "./paths.js";

let mainWindow: BrowserWindow | undefined;
let logger: Logger | undefined;
let dbService: DbService | undefined;
let bridge: SettingsBridge | undefined;

const JOURNAL_CANDIDATES = (): string[] => {
  const home = process.env["USERPROFILE"] ?? app.getPath("home");
  return [join(home, "Saved Games", "Frontier Developments", "Elite Dangerous")];
};

function focusExistingWindow(): void {
  if (mainWindow === undefined) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/**
 * Startup failures happen before the structured logger exists, and a packaged
 * GUI app has no console. Record the failure durably (best-effort emergency
 * file next to temp) and show it, so a bad data drive is never a silent crash.
 */
function reportFatalStartup(error: unknown): void {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  try {
    appendFileSync(join(app.getPath("temp"), "lodestar-startup-error.log"), `${message}\n`);
  } catch {
    // Emergency path itself failed — nothing more we can durably do.
  }
  try {
    dialog.showErrorBox("LODESTAR failed to start", message);
  } catch {
    console.error("LODESTAR failed to start:", message);
  }
}

try {
  // Redirect userData (caches, GPU cache, and our profile data) onto the
  // configured drive BEFORE anything else — nothing lands on C:, and the
  // single-instance lock is keyed on this profile, not a default one.
  const dataDir = getDataDir(app);
  mkdirSync(dataDir, { recursive: true });
  app.setPath("userData", dataDir);

  if (!acquireSingleInstance(app, focusExistingWindow)) {
    // Another instance already owns the lock. This marker lets the e2e test
    // distinguish a correct lock-denial quit from an unrelated crash.
    console.log("LODESTAR_SECOND_INSTANCE_QUIT");
  } else {
    app
      .whenReady()
      .then(bootstrap)
      .catch((error: unknown) => {
        reportFatalStartup(error);
        app.quit();
      });

    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow();
    });
  }
} catch (error) {
  reportFatalStartup(error);
  app.quit();
}

async function bootstrap(): Promise<void> {
  const dataDir = getDataDir(app);
  const logsDir = getLogsDir(app);
  mkdirSync(logsDir, { recursive: true });
  const destination = await createRollingDestination(logsDir);
  logger = createLogger({ destination, base: { app: "lodestar", version: APP_VERSION } });
  logger.info("main.starting", { dataDir });

  dbService = createDbService(join(dataDir, "lodestar.sqlite3"));
  if (dbService.status() === "ok") {
    logger.info("db.opened", { status: "ok" });
    bridge = createSettingsBridge({
      settings: createSettingsService(dbService.db),
      secrets: createSecretsStore(
        safeStorageBackend(),
        fileSecretStorage(join(dataDir, "secrets")),
      ),
      journalCandidates: JOURNAL_CANDIDATES,
    });
  } else {
    logger.error("db.open-failed", { error: String(dbService.lastError()) });
    bridge = createSettingsBridge({
      settings: undefined,
      secrets: undefined,
      journalCandidates: JOURNAL_CANDIDATES,
    });
  }

  const activeBridge = bridge;
  registerIpcHandlers(electronIpcAdapter(ipcMain), {
    getHealth: () =>
      buildHealth({
        version: APP_VERSION,
        db: () => dbService?.status() ?? "not-configured",
        journal: () => activeBridge.probeJournal(),
      }),
    getSettings: () => activeBridge.getSettings(),
    setSetting: (req) => activeBridge.setSetting(req),
    autodetectJournal: () => activeBridge.autodetectJournal(),
    getSecretsPresence: () => activeBridge.secretsPresence(),
    setSecret: (req) => activeBridge.setSecret(req),
    listGpus,
  });

  app.on("will-quit", () => {
    dbService?.close();
  });

  mainWindow = createMainWindow();
  logger.info("main.ready");
}
