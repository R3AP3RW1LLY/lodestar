import { defineConfig } from "@playwright/test";

// Electron smoke tests. Kept separate from the Vitest unit suite; run after a
// build (they launch the built app from out/main).
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
});
