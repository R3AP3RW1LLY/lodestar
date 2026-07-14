// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { RunPlanView } from "@lodestar/shared";
import { Cartographer, planWaypoints } from "./Cartographer.js";

const plan = (over: Partial<RunPlanView["candidate"]> = {}, cph = 90_000_000): RunPlanView => ({
  candidate: {
    ringName: "Paesia 2 A Ring",
    commodityId: "painite",
    systemName: "Paesia",
    miningTph: 150,
    sellStation: "Nemere Terminal",
    sellSystem: "Sol",
    sellPrice: 800_000,
    outboundLegs: [{ from: "Paesia", to: "Sol", distanceLy: 50, jumps: 2 }],
    returnLegs: [{ from: "Sol", to: "Paesia", distanceLy: 50, jumps: 2 }],
    minSecurity: 0.6,
    ...over,
  },
  fillTimeSec: 6144,
  travelTimeSec: 180,
  totalTimeSec: 6324,
  totalJumps: 4,
  cargoValue: 204_800_000,
  estimatedTph: 145,
  estimatedCph: cph,
});

const writeText = vi.fn().mockResolvedValue(undefined);

function stubApi(plans: RunPlanView[] = [plan()], planRejects = false) {
  const api = {
    planRuns: vi.fn(() => (planRejects ? Promise.reject(new Error("x")) : Promise.resolve(plans))),
    savePlan: vi.fn().mockResolvedValue({ runId: 42 }),
  };
  (globalThis as unknown as { window: { lodestar: unknown } }).window.lodestar = api;
  return api;
}

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(globalThis.navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});
afterEach(cleanup);

describe("planWaypoints", () => {
  it("is plain system names, mine → sell → return, without consecutive duplicates", () => {
    expect(planWaypoints(plan())).toEqual(["Paesia", "Sol", "Paesia"]);
    expect(planWaypoints(plan({ sellSystem: "Paesia" }))).toEqual(["Paesia"]); // same-system collapses
  });
});

describe("Cartographer screen", () => {
  it("renders ranked plan cards with the leg breakdown", async () => {
    stubApi();
    render(<Cartographer />);
    expect(await screen.findByText(/Painite — Paesia 2 A Ring/)).toBeInTheDocument();
    expect(screen.getByText(/Paesia → Sol · 2 jumps · 50.0 ly/)).toBeInTheDocument();
  });

  it("re-plans when the strategy changes", async () => {
    const api = stubApi();
    render(<Cartographer />);
    await screen.findByText(/Painite/);
    fireEvent.click(screen.getByText("Safest"));
    await waitFor(() => {
      expect(api.planRuns).toHaveBeenCalledWith("safest");
    });
  });

  it("copies the route as PLAIN SYSTEM NAMES (no game injection)", async () => {
    stubApi();
    render(<Cartographer />);
    fireEvent.click(await screen.findByText("Copy route"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Paesia\nSol\nPaesia");
    });
    expect(await screen.findByText("Copied ✓")).toBeInTheDocument();
  });

  it("saves a plan via IPC", async () => {
    const api = stubApi();
    render(<Cartographer />);
    fireEvent.click(await screen.findByText("Save plan"));
    await waitFor(() => {
      expect(api.savePlan).toHaveBeenCalledWith(0);
    });
    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
  });

  it("shows the zero-data state when nothing is plannable", async () => {
    stubApi([]);
    render(<Cartographer />);
    expect(await screen.findByText(/No plannable runs yet/i)).toBeInTheDocument();
  });

  it("shows an error state when planning fails", async () => {
    stubApi([], true);
    render(<Cartographer />);
    expect(await screen.findByText(/Could not build a plan/i)).toBeInTheDocument();
  });

  it("does not mark copied when the clipboard write fails", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    stubApi();
    render(<Cartographer />);
    fireEvent.click(await screen.findByText("Copy route"));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    expect(screen.queryByText("Copied ✓")).toBeNull();
  });

  it("does not mark saved when the run isn't persisted (null id) or the save fails", async () => {
    const api = stubApi();
    api.savePlan.mockResolvedValueOnce({ runId: null });
    render(<Cartographer />);
    fireEvent.click(await screen.findByText("Save plan"));
    await waitFor(() => {
      expect(api.savePlan).toHaveBeenCalled();
    });
    expect(screen.queryByText("Saved ✓")).toBeNull();
    // A rejecting save also doesn't crash.
    api.savePlan.mockRejectedValueOnce(new Error("x"));
    fireEvent.click(screen.getByText("Save plan"));
    expect(await screen.findByText(/Painite/)).toBeInTheDocument();
  });
});
