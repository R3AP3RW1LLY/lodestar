// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { ManifestData, SessionDetail } from "@lodestar/shared";
import { Manifest } from "./Manifest.js";

const session = {
  id: 1,
  startedAt: "2025-06-01T12:00:00Z",
  endedAt: "2025-06-01T13:00:00Z",
  ship: "Python",
  system: "Paesia",
  ring: "Paesia 2 A Ring",
  tonsRefined: 30,
  creditsEarned: 30_000_000,
  limpetsLaunched: 40,
  durationSec: 3600,
  tonsPerHour: 30,
  creditsPerHour: 30_000_000,
  prospected: 4,
  mineVerdicts: 3,
};

const MANIFEST: ManifestData = {
  sessions: [session, { ...session, id: 2, ship: "Cutter", tonsPerHour: 40 }],
  aggregate: {
    sessions: 2,
    tonsRefined: 50,
    creditsEarned: 70_000_000,
    limpetsLaunched: 70,
    totalDurationSec: 5400,
    avgTonsPerHour: 33.3,
    avgCreditsPerHour: 46_000_000,
    prospected: 6,
    mineVerdicts: 5,
    hitRate: 0.83,
  },
  breakdowns: {
    byCommodity: [
      {
        key: "painite",
        sessions: 1,
        tonsRefined: 30,
        creditsEarned: 30_000_000,
        durationSec: 3600,
        tonsPerHour: 30,
        creditsPerHour: 30_000_000,
      },
    ],
    byRing: [
      {
        key: "Paesia 2 A Ring",
        sessions: 2,
        tonsRefined: 50,
        creditsEarned: 70_000_000,
        durationSec: 5400,
        tonsPerHour: 33.3,
        creditsPerHour: 46_000_000,
      },
    ],
    byShip: [
      {
        key: "Python",
        sessions: 1,
        tonsRefined: 30,
        creditsEarned: 30_000_000,
        durationSec: 3600,
        tonsPerHour: 30,
        creditsPerHour: 30_000_000,
      },
    ],
    bestPairings: [
      {
        ring: "Paesia 2 A Ring",
        commodity: "painite",
        sessions: 1,
        tonsRefined: 30,
        durationSec: 3600,
        tonsPerHour: 30,
        creditsPerHour: 30_000_000,
      },
    ],
  },
  heatmaps: {
    timeProductivity: { rows: ["Mon"], cols: ["14"], cells: [[35]] },
    ringCommodityYield: { rows: ["Paesia 2 A Ring"], cols: ["painite"], cells: [[60]] },
  },
  trend: [
    {
      sessionId: 1,
      startedAt: "2025-06-01T12:00:00Z",
      tonsRefined: 30,
      tonsPerHour: 30,
      creditsPerHour: 30_000_000,
    },
    {
      sessionId: 2,
      startedAt: "2025-06-02T14:00:00Z",
      tonsRefined: 20,
      tonsPerHour: 40,
      creditsPerHour: 80_000_000,
    },
  ],
  efficiency: {
    limpets: {
      perSession: [],
      totals: {
        sessions: 2,
        prospectorLimpets: 8,
        collectionLimpets: 40,
        tonsRefined: 50,
        collectorProductivity: 1.25,
      },
    },
    timeSplit: {
      perSession: [],
      totals: {
        sessions: 2,
        durationSec: 5400,
        miningSec: 4000,
        otherSec: 1400,
        miningRatio: 0.74,
      },
    },
  },
  personalBests: [
    {
      category: "tons_per_hour",
      value: 40,
      sessionId: 2,
      ship: "Cutter",
      ring: "Paesia 2 A Ring",
      achievedAt: "2025-06-02T14:30:00Z",
    },
  ],
};

const EMPTY: ManifestData = { ...MANIFEST, sessions: [] };

const DETAIL: SessionDetail = {
  session,
  refinements: [
    { commodity: "painite", tons: 20 },
    { commodity: "platinum", tons: 10 },
  ],
  prospected: 4,
  mineVerdicts: 3,
  actedOn: 2,
  motherlodes: 1,
};

function stubApi(
  getManifest: () => Promise<ManifestData>,
  detail: SessionDetail | null = DETAIL,
): void {
  const api = {
    getManifest: vi.fn(getManifest),
    getSessionDetail: vi.fn().mockResolvedValue(detail),
    getLedgerBoard: vi.fn().mockResolvedValue([]),
    getLedgerStations: vi.fn().mockResolvedValue([]),
    getLedgerTrend: vi.fn().mockResolvedValue([]),
    listAlerts: vi.fn().mockResolvedValue([]),
    addAlert: vi.fn().mockResolvedValue([]),
    setAlertEnabled: vi.fn().mockResolvedValue([]),
    deleteAlert: vi.fn().mockResolvedValue([]),
    planRuns: vi.fn().mockResolvedValue([]),
    savePlan: vi.fn().mockResolvedValue({ runId: null }),
    findVeins: vi.fn().mockResolvedValue([]),
    exportAnalytics: vi.fn().mockResolvedValue({ ok: true, path: "D:/x.csv" }),
  };
  (globalThis as unknown as { window: { lodestar: unknown } }).window.lodestar = api;
}

afterEach(cleanup);

describe("Manifest", () => {
  it("renders every Phase-3 data feature from the bundle", async () => {
    stubApi(() => Promise.resolve(MANIFEST));
    render(<Manifest />);
    expect(await screen.findByTestId("manifest-kpis")).toBeInTheDocument();
    expect(screen.getByTestId("session-table")).toHaveTextContent("Python");
    expect(screen.getByTestId("bests-list")).toHaveTextContent("40.0 t/hr");
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
    expect(screen.getAllByTestId("heatmap")).toHaveLength(2);
    expect(screen.getByTestId("breakdowns")).toHaveTextContent("Paesia 2 A Ring");
    expect(screen.getByTestId("pairings")).toHaveTextContent("painite @ Paesia 2 A Ring");
    expect(screen.getByTestId("efficiency")).toHaveTextContent("1.25 t/limpet");
    expect(screen.getByTestId("mining-share")).toHaveTextContent("74%");
    expect(screen.getByTestId("export-buttons")).toBeInTheDocument();
  });

  it("drills into a session's detail on row click", async () => {
    stubApi(() => Promise.resolve(MANIFEST));
    render(<Manifest />);
    fireEvent.click(await screen.findByTestId("session-row-1"));
    const detail = await screen.findByTestId("session-detail");
    expect(detail).toBeInTheDocument();
    expect(await screen.findByTestId("detail-mix")).toHaveTextContent("painite");
    expect(
      (window.lodestar as unknown as { getSessionDetail: ReturnType<typeof vi.fn> })
        .getSessionDetail,
    ).toHaveBeenCalledWith(1);
  });

  it("triggers a CSV export on the sessions button", async () => {
    stubApi(() => Promise.resolve(MANIFEST));
    render(<Manifest />);
    fireEvent.click(await screen.findByTestId("export-sessions"));
    expect(
      (window.lodestar as unknown as { exportAnalytics: ReturnType<typeof vi.fn> }).exportAnalytics,
    ).toHaveBeenCalledWith({ kind: "sessions", bom: true });
  });

  it("shows the explicit zero-session first-run state", async () => {
    stubApi(() => Promise.resolve(EMPTY));
    render(<Manifest />);
    expect(await screen.findByTestId("manifest-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("session-table")).toBeNull();
  });

  it("shows an error state when the bundle fails to load", async () => {
    stubApi(() => Promise.reject(new Error("nope")));
    render(<Manifest />);
    expect(await screen.findByTestId("manifest-error")).toBeInTheDocument();
  });
});
