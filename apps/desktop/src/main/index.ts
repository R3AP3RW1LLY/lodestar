/**
 * Electron main entry (SSOT Step 0.4). Enforces single-instance, redirects all
 * runtime data to the configured data dir (D: on this machine per the operator
 * constraint), wires the pino logger, registers typed IPC, and boots the
 * Command Deck window.
 */

import { app, dialog, ipcMain, BrowserWindow } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { APP_VERSION, envelope } from "@lodestar/shared";
import type { Logger } from "@lodestar/shared";
import {
  createDbService,
  createSettingsService,
  createSecretsStore,
  createLiveEngine,
  createSessionRepository,
} from "@lodestar/core";
import type { DbService } from "@lodestar/core";
import { safeStorageBackend, fileSecretStorage } from "./secrets.js";
import { createSettingsBridge } from "./settings-bridge.js";
import type { SettingsBridge } from "./settings-bridge.js";
import { fileJournalCursorStore } from "./journal-cursor.js";
import { createStateBridge } from "./state-bridge.js";
import { createWsPushServer } from "./ws-server.js";
import type { WsPushServer } from "./ws-server.js";
import { listGpus } from "./gpu.js";
import { acquireSingleInstance } from "./app-lifecycle.js";
import { createMainWindow } from "./windows.js";
import { electronIpcAdapter, registerIpcHandlers } from "./ipc.js";
import { buildHealth } from "./health.js";
import { createLogger, createRollingDestination } from "./logger.js";
import { getDataDir, getLogsDir } from "./paths.js";
import { createTtsService } from "./tts-service.js";
import { wireAssay } from "./assay-wiring.js";
import type { AssayWiring } from "./assay-wiring.js";

let mainWindow: BrowserWindow | undefined;
let logger: Logger | undefined;
let dbService: DbService | undefined;
let bridge: SettingsBridge | undefined;
let wsServer: WsPushServer | undefined;

/**
 * Where the live engine watches: an explicit override (used by e2e + power users
 * to point at a non-default journal location), else the configured journal dir,
 * else the default location. Read-only — resolving the watch dir must NOT persist
 * a journal path (that is the Settings screen's job); the health probe stays
 * "not-configured" until the user configures it. Mirrors `LODESTAR_DATA_DIR`.
 */
function resolveJournalDir(settings: SettingsBridge): string {
  const override = process.env["LODESTAR_JOURNAL_DIR"];
  if (override !== undefined && override !== "") return override;
  const configured = settings.getSettings().journalPath;
  if (configured !== null) return configured;
  return JOURNAL_CANDIDATES()[0] ?? "";
}

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

  // Windows groups the taskbar icon by AppUserModelId — match the packaged appId
  // so the brand icon shows on the taskbar (and later, in notifications).
  app.setAppUserModelId("org.lodestar.app");

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
  const log = logger;

  // Live telemetry pipeline (Step 1.9): the engine folds the journal into a live
  // RootState + session summary; the state bridge pushes it to the renderer and
  // the loopback WS server (overlay, Step 2.10). Engine survives a missing dir —
  // the watcher just finds nothing until the journal path is configured.
  const repository =
    dbService.status() === "ok" ? createSessionRepository(dbService.db) : undefined;
  const engine = createLiveEngine({
    dir: resolveJournalDir(activeBridge),
    logger: log,
    cursorStore: fileJournalCursorStore(join(dataDir, "journal-cursor.json")),
    ...(repository !== undefined ? { repository } : {}),
  });

  const wsToken = randomBytes(32).toString("hex");
  wsServer = await createWsPushServer({ token: wsToken, logger: log });
  const ws = wsServer;

  mainWindow = createMainWindow();
  const window = mainWindow;

  const stateBridge = createStateBridge({
    engine,
    send: (env) => {
      if (!window.isDestroyed()) window.webContents.send(env.channel, env);
      ws.broadcast(env);
    },
    onError: (error) => {
      log.warn("state-bridge.send-failed", { error: String(error) });
    },
  });

  // TTS (Step 2.7b): synthesize verdict callouts + push them to the renderer for
  // playback. Assay wiring (2.6/2.7b) feeds the engine's prospects through the
  // verdict engine and hands each verdict to the speech service.
  const ttsService = createTtsService({
    dir: join(dataDir, "voices"),
    settings: () => {
      const s = activeBridge.getSettings();
      return { enabled: s.ttsEnabled, voice: s.ttsVoice, volume: s.ttsVolume };
    },
    emitAudio: (audio) => {
      if (!window.isDestroyed()) window.webContents.send("tts.audio", envelope("tts.audio", audio));
    },
    logger: log,
  });
  let assayWiring: AssayWiring | undefined;
  if (dbService.status() === "ok") {
    assayWiring = wireAssay({
      engine,
      db: dbService.db,
      onVerdict: ttsService.onVerdict,
      logger: log,
    });
  }

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
    subscribeState: () => stateBridge.snapshot(),
    testTts: () => ttsService.test(),
  });

  engine.start();

  app.on("will-quit", () => {
    engine.stop();
    stateBridge.stop();
    assayWiring?.dispose();
    void ws.close();
    dbService?.close();
  });

  log.info("main.ready", { wsPort: ws.port });
}
