import { describe, expect, it } from "vitest";
import { LOG_LEVELS, nullLogger } from "./logging.js";
import type { Logger } from "./logging.js";

describe("logging contract", () => {
  it("defines the six pino-compatible levels in severity order", () => {
    expect(LOG_LEVELS).toEqual(["trace", "debug", "info", "warn", "error", "fatal"]);
  });

  it("nullLogger implements every level as a safe no-op", () => {
    for (const level of LOG_LEVELS) {
      expect(() => nullLogger[level]("message", { key: "value" })).not.toThrow();
      expect(() => nullLogger[level]("message")).not.toThrow();
    }
  });

  it("nullLogger.child returns a Logger that is also a no-op", () => {
    const child: Logger = nullLogger.child({ module: "test" });
    for (const level of LOG_LEVELS) {
      expect(() => child[level]("m")).not.toThrow();
    }
  });
});
