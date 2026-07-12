/**
 * Idempotent native-ABI guard for better-sqlite3 (SSOT Step 0.6). The single
 * pinned binary is built for either the Node ABI (vitest/CI) or the Electron
 * ABI (the app). Running the app after a Node-ABI checkout would otherwise
 * crash with a cryptic NODE_MODULE_VERSION error during module load.
 *
 * This script records the ABI the binary was last built for in a marker file
 * and rebuilds only when it differs from the requested target — a few hundred
 * ms no-op when already correct. Usage: `node scripts/ensure-abi.mjs electron`.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";

const target = process.argv[2];
if (target !== "electron" && target !== "node") {
  console.error(`ensure-abi: target must be 'electron' or 'node', got '${String(target)}'`);
  process.exit(2);
}

const require = createRequire(import.meta.url);
const moduleDir = dirname(require.resolve("better-sqlite3/package.json"));
const marker = join(moduleDir, ".lodestar-abi");
const current = existsSync(marker) ? readFileSync(marker, "utf8").trim() : "";

if (current === target) {
  process.exit(0);
}

console.log(
  `ensure-abi: rebuilding better-sqlite3 for ${target} ABI (was '${current || "unknown"}')`,
);
// Remove any existing compiled artifact so the rebuild can't be skipped as
// "already built" (prebuild-install and node-gyp both no-op on a present .node).
rmSync(join(moduleDir, "build"), { recursive: true, force: true });

if (target === "electron") {
  execSync("pnpm exec electron-rebuild -f -w better-sqlite3", { stdio: "inherit" });
} else {
  // Run better-sqlite3's own install script (prebuild-install || node-gyp) in
  // its dir — pnpm rebuild is unreliable here, this restores the Node prebuild.
  execSync("npm run install", { cwd: moduleDir, stdio: "inherit" });
}
writeFileSync(marker, target, "utf8");
