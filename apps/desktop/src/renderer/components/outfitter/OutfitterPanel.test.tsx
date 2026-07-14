// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { OutfitterAdvice } from "@lodestar/shared";
import { OutfitterPanel } from "./OutfitterPanel.js";

const advice = (over: Partial<OutfitterAdvice> = {}): OutfitterAdvice => ({
  method: "deep-core",
  ship: "python",
  hasLoadout: true,
  present: [{ kind: "refinery", label: "Refinery" }],
  missingRequired: [
    {
      kind: "pwa",
      label: "Pulse Wave Analyser",
      category: "hardpoint",
      minSize: 0,
      reason: "required for deep-core",
      fitsShip: true,
    },
  ],
  suggestions: [
    {
      kind: "prospector-controller",
      label: "Prospector Limpet Controller",
      category: "optional-internal",
      minSize: 1,
      reason: "recommended for deep-core",
      fitsShip: true,
    },
  ],
  ...over,
});

function stubApi(result: OutfitterAdvice = advice()) {
  const api = { adviseOutfit: vi.fn().mockResolvedValue(result) };
  (globalThis as unknown as { window: { lodestar: unknown } }).window.lodestar = api;
  return api;
}

afterEach(cleanup);

describe("OutfitterPanel", () => {
  it("lists missing REQUIRED modules with the reason + recommendations", async () => {
    stubApi();
    render(<OutfitterPanel />);
    expect(await screen.findByText(/Pulse Wave Analyser/)).toBeInTheDocument();
    expect(screen.getByText(/required for deep-core/)).toBeInTheDocument();
    expect(screen.getByText(/Prospector Limpet Controller/)).toBeInTheDocument();
    expect(screen.getByText(/python/)).toBeInTheDocument();
  });

  it("re-advises when the method changes", async () => {
    const api = stubApi();
    render(<OutfitterPanel />);
    await screen.findByText(/Pulse Wave Analyser/);
    fireEvent.click(screen.getByText("Deep Core"));
    await waitFor(() => {
      expect(api.adviseOutfit).toHaveBeenCalledWith("deep-core");
    });
  });

  it("shows the all-clear when nothing required is missing", async () => {
    stubApi(advice({ missingRequired: [] }));
    render(<OutfitterPanel />);
    expect(await screen.findByText(/Equipped for deep-core/i)).toBeInTheDocument();
  });

  it("flags a required module that won't fit the ship", async () => {
    stubApi(
      advice({
        missingRequired: [
          {
            kind: "mining-laser",
            label: "Mining Laser",
            category: "hardpoint",
            minSize: 1,
            reason: "required for laser",
            fitsShip: false,
          },
        ],
      }),
    );
    render(<OutfitterPanel />);
    expect(await screen.findByText(/does not fit this ship/i)).toBeInTheDocument();
  });

  it("shows a no-loadout first-run state", async () => {
    stubApi(advice({ hasLoadout: false, ship: null }));
    render(<OutfitterPanel />);
    expect(await screen.findByText(/No loadout captured yet/i)).toBeInTheDocument();
  });

  it("degrades gracefully if the advisor call fails", async () => {
    const api = { adviseOutfit: vi.fn().mockRejectedValue(new Error("x")) };
    (globalThis as unknown as { window: { lodestar: unknown } }).window.lodestar = api;
    render(<OutfitterPanel />);
    expect(await screen.findByText(/No loadout captured yet/i)).toBeInTheDocument();
  });
});
