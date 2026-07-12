import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";
import process from "node:process";
import { getDataDir, getLogsDir, isSafeDataDir } from "./paths.js";

const ORIGINAL = process.env["LODESTAR_DATA_DIR"];

describe("data paths", () => {
  beforeEach(() => {
    delete process.env["LODESTAR_DATA_DIR"];
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env["LODESTAR_DATA_DIR"];
    else process.env["LODESTAR_DATA_DIR"] = ORIGINAL;
  });

  it("defaults to the app userData directory when no override is set", () => {
    const app = { getPath: (name: string) => (name === "userData" ? "C:\\default\\userData" : "") };
    expect(getDataDir(app)).toBe("C:\\default\\userData");
  });

  it("honors LODESTAR_DATA_DIR so runtime data can live off the system drive", () => {
    process.env["LODESTAR_DATA_DIR"] = "D:\\lodestar-data";
    const app = { getPath: () => "C:\\default\\userData" };
    expect(getDataDir(app)).toBe("D:\\lodestar-data");
  });

  it("derives the logs directory under the data directory", () => {
    process.env["LODESTAR_DATA_DIR"] = "D:\\lodestar-data";
    const app = { getPath: () => "C:\\default\\userData" };
    expect(getLogsDir(app)).toBe(join("D:\\lodestar-data", "logs"));
  });

  it("refuses a UNC override (SMB egress / NTLM-leak vector)", () => {
    process.env["LODESTAR_DATA_DIR"] = "\\\\attacker\\share\\data";
    const app = { getPath: () => "C:\\default\\userData" };
    expect(() => getDataDir(app)).toThrow(/UNC/);
  });

  it("isSafeDataDir accepts local absolute paths and rejects UNC/relative", () => {
    expect(isSafeDataDir("D:\\lodestar-data")).toBe(true);
    expect(isSafeDataDir("C:/x/y")).toBe(true);
    expect(isSafeDataDir("/var/lib/lodestar")).toBe(true);
    expect(isSafeDataDir("\\\\host\\share")).toBe(false);
    expect(isSafeDataDir("//host/share")).toBe(false);
    expect(isSafeDataDir("relative/path")).toBe(false);
  });
});
