import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { AssayVerdictEvent } from "@lodestar/shared";
import { VerdictHud } from "./VerdictHud.js";

const base: Omit<AssayVerdictEvent, "call" | "materials"> = {
  prospectId: 1,
  score: 0,
  reasons: [],
  method: "laser",
  timestamp: "2025-06-01T12:00:00Z",
  content: "$AsteroidMaterialContent_Low;",
  remainingPct: 100,
};

afterEach(cleanup);

describe("VerdictHud", () => {
  it("shows a SKIP call and no commodity line when there are no materials", () => {
    render(<VerdictHud verdict={{ ...base, call: "SKIP", materials: [] }} />);
    expect(screen.getByTestId("verdict-call").textContent).toBe("SKIP");
    expect(screen.queryByTestId("verdict-top")).toBeNull();
  });
});
