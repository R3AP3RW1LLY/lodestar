import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mainWindow } from "./helpers.js";

const APP_ENTRY = join(import.meta.dirname, "..", "out", "main", "index.cjs");

/**
 * Exercises the REAL Electron safeStorage crypto in the main process (unit
 * tests use a fake backend; safeStorageBackend maps 1:1 onto these calls).
 * Verifies encryption is available, a secret round-trips, and the ciphertext
 * does not contain the plaintext.
 */
test("real safeStorage encrypts and round-trips a secret without plaintext", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "lodestar-secrets-e2e-"));
  const app = await electron.launch({
    args: [APP_ENTRY],
    env: { ...process.env, LODESTAR_DATA_DIR: dataDir },
  });
  try {
    await mainWindow(app);
    const result = await app.evaluate(({ safeStorage }) => {
      const secret = "sk-LIVE-e2e-should-not-appear-plaintext";
      const available = safeStorage.isEncryptionAvailable();
      if (!available) return { available, roundTrip: null, cipherHasPlaintext: true };
      const cipher = safeStorage.encryptString(secret);
      return {
        available,
        roundTrip: safeStorage.decryptString(cipher),
        cipherHasPlaintext: cipher.toString("latin1").includes(secret),
      };
    });
    expect(result.available).toBe(true);
    expect(result.roundTrip).toBe("sk-LIVE-e2e-should-not-appear-plaintext");
    expect(result.cipherHasPlaintext).toBe(false);
  } finally {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});
