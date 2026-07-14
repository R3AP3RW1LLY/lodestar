// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type {
  LedgerAlertRule,
  LedgerBoardEntry,
  LedgerStation,
  LedgerTrendPoint,
} from "@lodestar/shared";
import { Ledger } from "./Ledger.js";

const NOW = Date.now();

const painiteStation: LedgerStation = {
  commodityId: "painite",
  marketId: 1,
  stationName: "Nemere Terminal",
  systemName: "Paesia",
  sellPrice: 512_340,
  source: "journal",
  sourceTsMs: NOW,
  padSize: "L",
  demand: 900,
  ageMs: 0,
  score: 512_340,
};

const BOARD: LedgerBoardEntry[] = [
  { commodityId: "painite", best: painiteStation },
  { commodityId: "platinum", best: null },
];

const STATIONS: LedgerStation[] = [
  painiteStation,
  {
    ...painiteStation,
    marketId: 2,
    stationName: "Old Port",
    systemName: "Borann",
    source: "eddn",
    sourceTsMs: NOW - 3 * 24 * 60 * 60 * 1000,
    padSize: "M",
  },
];

const TREND: LedgerTrendPoint[] = [
  { tMs: 0, avgSellPrice: 400_000, maxSellPrice: 450_000, samples: 2 },
  { tMs: 86_400_000, avgSellPrice: 500_000, maxSellPrice: 550_000, samples: 3 },
];

const ALERTS: LedgerAlertRule[] = [
  {
    id: 7,
    kind: "price-threshold",
    label: null,
    commodityId: "painite",
    threshold: 500_000,
    direction: "above",
    cooldownMs: 0,
    enabled: true,
    lastFiredTs: null,
    createdAt: "2025-06-01T00:00:00Z",
  },
];

interface Overrides {
  board?: LedgerBoardEntry[];
  stations?: LedgerStation[];
  trend?: LedgerTrendPoint[];
  alerts?: LedgerAlertRule[];
  boardRejects?: boolean;
}

function stubApi(o: Overrides = {}) {
  const api = {
    getLedgerBoard: vi.fn(() =>
      o.boardRejects === true ? Promise.reject(new Error("x")) : Promise.resolve(o.board ?? BOARD),
    ),
    getLedgerStations: vi.fn().mockResolvedValue(o.stations ?? STATIONS),
    getLedgerTrend: vi.fn().mockResolvedValue(o.trend ?? TREND),
    listAlerts: vi.fn().mockResolvedValue(o.alerts ?? ALERTS),
    addAlert: vi.fn().mockResolvedValue(o.alerts ?? ALERTS),
    setAlertEnabled: vi.fn().mockResolvedValue(o.alerts ?? ALERTS),
    deleteAlert: vi.fn().mockResolvedValue([]),
  };
  (globalThis as unknown as { window: { lodestar: unknown } }).window.lodestar = api;
  return api;
}

afterEach(cleanup);

describe("Ledger screen", () => {
  it("renders the commodity board and drills into the first commodity's stations", async () => {
    stubApi();
    render(<Ledger />);
    expect(await screen.findByText("Painite")).toBeInTheDocument();
    // The selected commodity's station ranking renders.
    expect(await screen.findByText("Nemere Terminal")).toBeInTheDocument();
    expect(screen.getByText("Old Port")).toBeInTheDocument();
  });

  it("shows the SOURCE + data-age on every station price", async () => {
    stubApi();
    render(<Ledger />);
    await screen.findByText("Nemere Terminal");
    // Both provenance labels are visible in the ranking table.
    expect(screen.getAllByText("journal").length).toBeGreaterThan(0);
    expect(screen.getByText("eddn")).toBeInTheDocument();
    // The data-age badge carries the source + timestamp in its title.
    expect(document.querySelector('[title^="journal ·"]')).not.toBeNull();
  });

  it("selecting a different commodity refetches its stations", async () => {
    const api = stubApi();
    render(<Ledger />);
    fireEvent.click(await screen.findByText("Platinum"));
    await waitFor(() => {
      expect(api.getLedgerStations).toHaveBeenCalledWith({ commodityId: "platinum" });
    });
  });

  it("shows an explicit zero-data first-run state", async () => {
    stubApi({ board: [] });
    render(<Ledger />);
    expect(await screen.findByText(/No market data yet/i)).toBeInTheDocument();
  });

  it("shows an error state when the ledger fails to load", async () => {
    stubApi({ boardRejects: true });
    render(<Ledger />);
    expect(await screen.findByText(/Could not load the ledger/i)).toBeInTheDocument();
  });

  it("adds an alert rule from the manager form", async () => {
    const api = stubApi();
    render(<Ledger />);
    await screen.findByText("Painite");
    fireEvent.change(screen.getByLabelText("alert threshold"), { target: { value: "750000" } });
    fireEvent.click(screen.getByText("Add rule"));
    await waitFor(() => {
      expect(api.addAlert).toHaveBeenCalledWith({
        kind: "price-threshold",
        commodityId: "painite",
        threshold: 750_000,
        direction: "above",
      });
    });
  });

  it("toggles and deletes an alert rule", async () => {
    const api = stubApi();
    render(<Ledger />);
    fireEvent.click(await screen.findByLabelText("toggle rule 7"));
    await waitFor(() => {
      expect(api.setAlertEnabled).toHaveBeenCalledWith({ id: 7, enabled: false });
    });
    fireEvent.click(screen.getByLabelText("delete rule 7"));
    await waitFor(() => {
      expect(api.deleteAlert).toHaveBeenCalledWith({ id: 7 });
    });
  });

  it("adds a cargo-full alert, hiding the commodity + direction fields", async () => {
    const api = stubApi();
    render(<Ledger />);
    await screen.findByText("Painite");
    fireEvent.change(screen.getByLabelText("alert kind"), { target: { value: "cargo-full" } });
    expect(screen.queryByLabelText("alert commodity")).toBeNull();
    expect(screen.queryByLabelText("alert direction")).toBeNull();
    fireEvent.change(screen.getByLabelText("alert threshold"), { target: { value: "80" } });
    fireEvent.click(screen.getByText("Add rule"));
    await waitFor(() => {
      expect(api.addAlert).toHaveBeenCalledWith({ kind: "cargo-full", threshold: 80 });
    });
  });

  it("renders a cargo-full rule label", async () => {
    stubApi({
      alerts: [
        {
          ...ALERTS[0],
          id: 8,
          kind: "cargo-full",
          commodityId: null,
          threshold: 90,
        } as LedgerAlertRule,
      ],
    });
    render(<Ledger />);
    expect(await screen.findByText(/Cargo ≥ 90%/)).toBeInTheDocument();
  });

  it("ignores a non-numeric alert threshold", async () => {
    const api = stubApi();
    render(<Ledger />);
    await screen.findByText("Painite");
    fireEvent.change(screen.getByLabelText("alert threshold"), { target: { value: "abc" } });
    fireEvent.click(screen.getByText("Add rule"));
    expect(api.addAlert).not.toHaveBeenCalled();
  });

  it("shows the empty station state + no-trend hint when a commodity has no data", async () => {
    stubApi({ stations: [], trend: [] });
    render(<Ledger />);
    expect(await screen.findByText(/No market observations/i)).toBeInTheDocument();
    expect(screen.getByText(/Not enough history/i)).toBeInTheDocument();
  });

  it("clears the station table when a station fetch fails", async () => {
    const api = stubApi();
    api.getLedgerStations.mockRejectedValue(new Error("x"));
    render(<Ledger />);
    expect(await screen.findByText(/No market observations/i)).toBeInTheDocument();
  });

  it("survives an alert action rejection without crashing", async () => {
    const api = stubApi();
    api.addAlert.mockRejectedValue(new Error("x"));
    api.setAlertEnabled.mockRejectedValue(new Error("x"));
    api.deleteAlert.mockRejectedValue(new Error("x"));
    render(<Ledger />);
    fireEvent.click(await screen.findByLabelText("toggle rule 7"));
    fireEvent.click(screen.getByLabelText("delete rule 7"));
    fireEvent.change(screen.getByLabelText("alert threshold"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Add rule"));
    expect(await screen.findByText("Painite")).toBeInTheDocument();
  });
});
