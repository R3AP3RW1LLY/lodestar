// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { DataAgeBadge } from "./DataAgeBadge.js";

const NOW = Date.parse("2026-07-12T12:00:00.000Z");
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

afterEach(cleanup);

describe("DataAgeBadge", () => {
  it("renders LIVE for fresh data with a title carrying provenance", () => {
    render(<DataAgeBadge timestamp={ago(0)} now={NOW} source="EDDN" />);
    const badge = screen.getByText("LIVE");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", expect.stringContaining("EDDN"));
  });

  it("renders the fresh/aging/old buckets with numeric labels", () => {
    const { rerender } = render(<DataAgeBadge timestamp={ago(30_000)} now={NOW} source="EDDN" />);
    expect(screen.getByText("30s")).toBeInTheDocument();
    rerender(<DataAgeBadge timestamp={ago(12 * 60_000)} now={NOW} source="EDDN" />);
    expect(screen.getByText("12m")).toBeInTheDocument();
    rerender(<DataAgeBadge timestamp={ago(3 * 3_600_000)} now={NOW} source="EDDN" />);
    expect(screen.getByText("3h")).toBeInTheDocument();
  });

  it("renders STALE for day-old data", () => {
    render(<DataAgeBadge timestamp={ago(48 * 3_600_000)} now={NOW} source="EDSM" />);
    expect(screen.getByText("STALE")).toBeInTheDocument();
  });

  it("accepts a millisecond-number timestamp", () => {
    render(<DataAgeBadge timestamp={NOW - 30_000} now={NOW} source="cAPI" />);
    expect(screen.getByText("30s")).toBeInTheDocument();
  });

  it("renders the em-dash for an unknown string timestamp", () => {
    render(<DataAgeBadge timestamp="garbage" now={NOW} source="Inara" />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("does not crash on a NaN numeric timestamp — shows the safe fallback", () => {
    render(<DataAgeBadge timestamp={Number.NaN} now={NOW} source="Inara" />);
    const badge = screen.getByText("—");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", expect.stringContaining("unknown"));
  });

  it("falls back to the real clock when no `now` is injected", () => {
    // Epoch-0 data is decades old against the live clock → the badge still renders
    // (exercising the default Date.now() path), carrying its source provenance.
    render(<DataAgeBadge timestamp={0} source="EDSM" />);
    expect(screen.getByTitle(/EDSM/)).toBeInTheDocument();
  });
});
