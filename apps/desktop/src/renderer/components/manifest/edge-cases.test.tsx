// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { BestCategory, PersonalBest, SessionListItem } from "@lodestar/shared";
import { HeatmapGrid, Sparkline, TrendChart } from "./charts.js";
import { BreakdownsPanel, PersonalBestsBoard, fmtDuration } from "./panels.js";
import { SessionDetailPanel } from "./SessionDetailPanel.js";
import { ExportButtons } from "./ExportButtons.js";

const SESSION: SessionListItem = {
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

const best = (category: BestCategory, value: number): PersonalBest => ({
  category,
  value,
  sessionId: 1,
  ship: "Python",
  ring: "R",
  achievedAt: "2025-06-01T13:00:00Z",
});

afterEach(cleanup);

describe("manifest viz edge/empty states", () => {
  it("Sparkline renders nothing for fewer than two points", () => {
    const { container } = render(<Sparkline values={[5]} />);
    expect(container.querySelector('[data-testid="sparkline"]')).toBeNull();
  });

  it("TrendChart shows an empty note for fewer than two points", () => {
    render(<TrendChart trend={[]} />);
    expect(screen.getByTestId("trend-empty")).toBeInTheDocument();
  });

  it("HeatmapGrid: empty note with no rows; blanks null cells otherwise", () => {
    render(<HeatmapGrid heatmap={{ rows: [], cols: [], cells: [] }} label="x" />);
    expect(screen.getByTestId("heatmap-empty")).toBeInTheDocument();
    cleanup();
    render(
      <HeatmapGrid heatmap={{ rows: ["A"], cols: ["p", "q"], cells: [[10, null]] }} label="y" />,
    );
    const empties = [...screen.getByTestId("heatmap").querySelectorAll("td[data-empty]")];
    expect(empties.some((c) => c.getAttribute("data-empty") === "true")).toBe(true);
    expect(empties.some((c) => c.getAttribute("data-empty") === "false")).toBe(true);
  });
});

describe("manifest panels edge/empty states", () => {
  it("PersonalBestsBoard: empty note, and formats every category", () => {
    render(<PersonalBestsBoard bests={[]} />);
    expect(screen.getByTestId("bests-empty")).toBeInTheDocument();
    cleanup();
    render(
      <PersonalBestsBoard
        bests={[
          best("tons_per_hour", 40),
          best("credits_per_hour", 1_000_000),
          best("single_rock_value", 2_000_000),
          best("longest_session", 3600),
          best("most_tons", 30),
        ]}
      />,
    );
    const list = screen.getByTestId("bests-list");
    expect(list).toHaveTextContent("40.0 t/hr");
    expect(list).toHaveTextContent("1h 00m"); // longest_session
    expect(list).toHaveTextContent("30 t"); // most_tons
    expect(list).toHaveTextContent("1,000,000 cr"); // credits/hr
  });

  it("BreakdownsPanel renders dashes when everything is empty", () => {
    render(
      <BreakdownsPanel
        breakdowns={{ byCommodity: [], byRing: [], byShip: [], bestPairings: [] }}
      />,
    );
    expect(screen.getByTestId("breakdowns")).toBeInTheDocument();
  });

  it("SessionDetailPanel: empty prompt; a session with no refinements", () => {
    render(<SessionDetailPanel detail={null} />);
    expect(screen.getByTestId("detail-empty")).toBeInTheDocument();
    cleanup();
    render(
      <SessionDetailPanel
        detail={{
          session: SESSION,
          refinements: [],
          prospected: 0,
          mineVerdicts: 0,
          actedOn: 0,
          motherlodes: 0,
        }}
      />,
    );
    expect(screen.getByTestId("session-detail")).toHaveTextContent("Python");
  });

  it("fmtDuration formats hours, minutes, and seconds", () => {
    expect(fmtDuration(3660)).toBe("1h 01m");
    expect(fmtDuration(120)).toBe("2m");
    expect(fmtDuration(30)).toBe("30s");
  });
});

describe("ExportButtons", () => {
  it("reports a cancelled export", async () => {
    (globalThis as unknown as { window: { lodestar: unknown } }).window.lodestar = {
      exportAnalytics: vi.fn().mockResolvedValue({ ok: false, path: null }),
    };
    render(<ExportButtons />);
    fireEvent.click(screen.getByTestId("export-prospects"));
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
  });
});
