import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ElectronApplication } from "@playwright/test";
import { mainWindow } from "./helpers.js";

const APP_ENTRY = join(import.meta.dirname, "..", "out", "main", "index.cjs");

const OLLAMA_ENDPOINT = "http://127.0.0.1:12345";
// A secret-shaped fixture; the sentinels (LIVE-e2e / should-not) mark it so the
// compliance secret scan tells it from a real leak. A real key never contains them.
const INARA_KEY = "sk-LIVE-e2e-should-not-persist-plaintext-key";

let dataDir: string;

test.beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "lodestar-persist-e2e-"));
});

test.afterEach(() => {
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch {
    // Best-effort teardown: on Windows two sequential Electron processes can hold
    // the shared data dir's handle briefly past close; the OS reaps the temp dir.
    // What this test proves — persistence across restart — already asserted above.
  }
});

function launch(): Promise<ElectronApplication> {
  return electron.launch({
    args: [APP_ENTRY],
    env: { ...process.env, LODESTAR_DATA_DIR: dataDir },
  });
}

interface Api {
  setSetting: (r: { key: string; value: string }) => Promise<{ ollamaEndpoint: string }>;
  setSecret: (r: { key: string; value: string }) => Promise<Record<string, boolean>>;
  getSettings: () => Promise<{ ollamaEndpoint: string }>;
  getSecretsPresence: () => Promise<Record<string, boolean>>;
}

/**
 * The DoD names this composed behavior explicitly: "settings persist including
 * encrypted secrets." Unit tests prove each layer against in-memory doubles; this
 * drives the REAL IPC surface (setSetting → SQLite; setSecret → safeStorage →
 * fileSecretStorage) and then RESTARTS the app on the same data dir to prove the
 * values actually survived to disk and back.
 */
test("settings and encrypted secrets persist across an app restart", async () => {
  const first = await launch();
  const firstWindow = await mainWindow(first);
  const wrote = await firstWindow.evaluate(
    async (input: { endpoint: string; key: string }) => {
      const api = (window as unknown as { lodestar: Api }).lodestar;
      const settings = await api.setSetting({ key: "ollamaEndpoint", value: input.endpoint });
      const presence = await api.setSecret({ key: "inaraApiKey", value: input.key });
      return { endpoint: settings.ollamaEndpoint, inaraSet: presence["inaraApiKey"] === true };
    },
    { endpoint: OLLAMA_ENDPOINT, key: INARA_KEY },
  );
  expect(wrote.endpoint).toBe(OLLAMA_ENDPOINT);
  expect(wrote.inaraSet).toBe(true);
  await first.close();

  // Relaunch on the SAME data dir — nothing should be re-entered.
  const second = await launch();
  const secondWindow = await mainWindow(second);
  const read = await secondWindow.evaluate(async () => {
    const api = (window as unknown as { lodestar: Api }).lodestar;
    const settings = await api.getSettings();
    const presence = await api.getSecretsPresence();
    return { endpoint: settings.ollamaEndpoint, inaraSet: presence["inaraApiKey"] === true };
  });
  try {
    expect(read.endpoint).toBe(OLLAMA_ENDPOINT);
    expect(read.inaraSet).toBe(true);
  } finally {
    await second.close();
  }
});
