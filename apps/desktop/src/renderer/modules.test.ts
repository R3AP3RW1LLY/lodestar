import { describe, expect, it } from "vitest";
import { MODULES, moduleById } from "./modules.js";

describe("moduleById", () => {
  it("returns the definition for a known module id", () => {
    expect(moduleById("command-deck")).toMatchObject({ id: "command-deck", available: true });
    expect(moduleById("settings").phase).toBe(0);
  });

  it("throws for an unknown module id (registry is the single source of truth)", () => {
    expect(() => moduleById("nonexistent" as (typeof MODULES)[number]["id"])).toThrow(
      /unknown module: nonexistent/,
    );
  });
});
