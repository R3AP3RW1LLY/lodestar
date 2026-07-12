import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./version.js";
import sharedPkg from "../package.json";
import rootPkg from "../../../package.json";

describe("APP_VERSION single-source parity", () => {
  it("matches @lodestar/shared's package.json version", () => {
    expect(APP_VERSION).toBe(sharedPkg.version);
  });

  it("matches the root package.json version (release tooling bumps that)", () => {
    expect(APP_VERSION).toBe(rootPkg.version);
  });
});
