/**
 * Runtime data locations. All profile data — SQLite DB, logs, config,
 * encrypted secrets, and (later) ML/voice models — lives under one data
 * directory. It defaults to Electron's `userData`, but honors the
 * LODESTAR_DATA_DIR override so the operator can keep runtime data (which
 * grows large: DBs, models) off the system drive (SSOT §3.1, operator
 * constraint 2026-07-12: this machine runs data on D:, not C:).
 */

import { join } from "node:path";
import process from "node:process";

export interface PathProvider {
  getPath: (name: "userData") => string;
}

/**
 * Rejects UNC paths (`\\host\share`). A UNC data dir would make mkdirSync open
 * an outbound SMB connection — an NTLM-hash-leak vector that also violates the
 * no-egress posture. Only local, absolute, drive-rooted paths are accepted.
 */
export function isSafeDataDir(path: string): boolean {
  if (path.startsWith("\\\\") || path.startsWith("//")) return false;
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/");
}

export function getDataDir(app: PathProvider): string {
  const override = process.env["LODESTAR_DATA_DIR"];
  if (override !== undefined && override.length > 0) {
    if (!isSafeDataDir(override)) {
      throw new Error(
        `LODESTAR_DATA_DIR must be a local absolute path (got "${override}"); UNC paths are refused.`,
      );
    }
    return override;
  }
  return app.getPath("userData");
}

export function getLogsDir(app: PathProvider): string {
  return join(getDataDir(app), "logs");
}
