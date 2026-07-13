// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MODULE_SCREENS, ModuleView } from "./routes.js";
import { MODULES } from "./modules.js";

// Settings + Command Deck touch window.lodestar on mount; provide a minimal fake.
(globalThis as unknown as { window: { lodestar: unknown } }).window.lodestar = {
  getSettings: vi.fn().mockResolvedValue({}),
  getSecretsPresence: vi.fn().mockResolvedValue({}),
  getHealth: vi.fn().mockResolvedValue({ version: "0", dbStatus: "ok", journalStatus: "ok" }),
  getStateSnapshot: vi.fn(() => new Promise(() => {})),
  onStateDelta: vi.fn(() => () => {}),
  onSessionStats: vi.fn(() => () => {}),
};

afterEach(cleanup);

describe("ModuleView", () => {
  it("renders the 'arrives in Phase N' notice for an unbuilt module (defense-in-depth path)", () => {
    render(<ModuleView active="assay" />);
    expect(screen.getByText(/arrives in/i)).toHaveTextContent(/phase 2/i);
  });

  it("renders the Command Deck for the command-deck module", () => {
    render(<ModuleView active="command-deck" />);
    expect(screen.getByRole("heading", { name: /command deck/i })).toBeInTheDocument();
  });

  it("every AVAILABLE module has a registered screen (no drift with modules.ts)", () => {
    for (const module of MODULES.filter((m) => m.available)) {
      expect(
        MODULE_SCREENS[module.id],
        `module ${module.id} is available but has no screen`,
      ).toBeDefined();
    }
  });

  it("no UNAVAILABLE module has a screen (they must show the arrival notice)", () => {
    for (const module of MODULES.filter((m) => !m.available)) {
      expect(MODULE_SCREENS[module.id]).toBeUndefined();
    }
  });
});
