import { describe, expect, it } from "vitest";
import { buildHealth } from "./health.js";

describe("buildHealth", () => {
  it("reports the app version and probe statuses", () => {
    const health = buildHealth({
      version: "0.1.0",
      db: () => "not-configured",
      journal: () => "not-configured",
    });
    expect(health).toEqual({
      version: "0.1.0",
      dbStatus: "not-configured",
      journalStatus: "not-configured",
    });
  });

  it("reflects live probe results (real values, not constants)", () => {
    const health = buildHealth({
      version: "9.9.9",
      db: () => "ok",
      journal: () => "error",
    });
    expect(health.dbStatus).toBe("ok");
    expect(health.journalStatus).toBe("error");
    expect(health.version).toBe("9.9.9");
  });
});
