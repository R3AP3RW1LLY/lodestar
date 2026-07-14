// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { VeinCandidate } from "@lodestar/shared";
import { VeinFinder } from "./VeinFinder.js";

const NOW = Date.now();

const candidate = (over: Partial<VeinCandidate> = {}): VeinCandidate => ({
  ringName: "Paesia 2 A Ring",
  commodityId: "painite",
  systemName: "Paesia",
  ringType: "Metallic",
  reserve: "Pristine",
  padSize: "L",
  hotspotCount: 2,
  sellPrice: 700_000,
  sellStation: "Nemere",
  sellSystem: "Paesia",
  distanceLy: 12.5,
  overlap: "candidate",
  overlapCommodities: ["painite", "platinum"],
  breakdown: {
    price: 700_000,
    overlapMultiplier: 1,
    reserveWeight: 1,
    ringMatch: 1,
    base: 700_000,
    distancePenalty: 6250,
    sellLegPenalty: 0,
    score: 693_750,
  },
  score: 693_750,
  source: "journal",
  updatedAtMs: NOW,
  ...over,
});

function stubApi(veins: VeinCandidate[] = [candidate()], rejects = false) {
  const api = {
    findVeins: vi.fn(() => (rejects ? Promise.reject(new Error("x")) : Promise.resolve(veins))),
  };
  (globalThis as unknown as { window: { lodestar: unknown } }).window.lodestar = api;
  return api;
}

afterEach(cleanup);

describe("Vein Finder screen", () => {
  it("renders scored candidates with overlap badge + data-age + the 'why' breakdown", async () => {
    stubApi();
    render(<VeinFinder />);
    expect(await screen.findByText(/Painite — Paesia 2 A Ring/)).toBeInTheDocument();
    expect(screen.getByText(/possible — verify in ring/i)).toBeInTheDocument();
    // The "why" line mirrors the 4.5 terms (price × … − penalties = score).
    expect(screen.getByText(/why:/)).toHaveTextContent(/= 693,750/);
    expect(screen.getByText("journal")).toBeInTheDocument();
  });

  it("filters compose — each control adds to the query", async () => {
    const api = stubApi();
    render(<VeinFinder />);
    await screen.findByText(/Painite/);
    fireEvent.change(screen.getByLabelText("filter commodity"), { target: { value: "painite" } });
    fireEvent.change(screen.getByLabelText("filter reserve"), { target: { value: "Pristine" } });
    fireEvent.change(screen.getByLabelText("filter ring type"), { target: { value: "Metallic" } });
    fireEvent.change(screen.getByLabelText("filter max distance"), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText("filter min pad"), { target: { value: "L" } });
    await waitFor(() => {
      expect(api.findVeins).toHaveBeenLastCalledWith({
        commodityId: "painite",
        reserve: "Pristine",
        ringType: "Metallic",
        maxDistanceLy: 50,
        minPad: "L",
      });
    });
    // Clearing a control drops the key (not set to undefined).
    fireEvent.change(screen.getByLabelText("filter reserve"), { target: { value: "" } });
    await waitFor(() => {
      expect(api.findVeins).toHaveBeenLastCalledWith({
        commodityId: "painite",
        ringType: "Metallic",
        maxDistanceLy: 50,
        minPad: "L",
      });
    });
  });

  it("the default handoff navigates without crashing when no onPlan is provided", async () => {
    stubApi();
    render(<VeinFinder />);
    fireEvent.click(await screen.findByText("Plan this")); // default onPlan → navigateTo (no-op in test)
    expect(await screen.findByText(/Painite/)).toBeInTheDocument();
  });

  it("hands off to the planner with the selected commodity", async () => {
    stubApi();
    const onPlan = vi.fn();
    render(<VeinFinder onPlan={onPlan} />);
    fireEvent.click(await screen.findByText("Plan this"));
    expect(onPlan).toHaveBeenCalledWith("painite");
  });

  it("labels a seed-only first-run state with provenance", async () => {
    stubApi([candidate({ source: "seed", overlap: "none", overlapCommodities: [] })]);
    render(<VeinFinder />);
    expect(await screen.findByText(/Showing seed data/i)).toBeInTheDocument();
  });

  it("shows the empty + error states", async () => {
    stubApi([]);
    const { unmount } = render(<VeinFinder />);
    expect(await screen.findByText(/No hotspots match/i)).toBeInTheDocument();
    unmount();
    stubApi([], true);
    render(<VeinFinder />);
    expect(await screen.findByText(/Could not load hotspots/i)).toBeInTheDocument();
  });

  it("shows a confirmed overlap badge", async () => {
    stubApi([candidate({ overlap: "confirmed" })]);
    render(<VeinFinder />);
    expect(await screen.findByText(/overlap ✓/i)).toBeInTheDocument();
  });
});
