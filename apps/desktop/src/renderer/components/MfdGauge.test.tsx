// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MfdGauge, gaugeFillPercent } from "./MfdGauge.js";

afterEach(cleanup);

describe("gaugeFillPercent", () => {
  it("computes the proportional fill", () => {
    expect(gaugeFillPercent(50, 200)).toBe(25);
    expect(gaugeFillPercent(0, 200)).toBe(0);
    expect(gaugeFillPercent(200, 200)).toBe(100);
  });

  it("clamps out-of-range values to 0..100", () => {
    expect(gaugeFillPercent(300, 200)).toBe(100);
    expect(gaugeFillPercent(-10, 200)).toBe(0);
  });

  it("returns 0 for a non-positive max (avoids divide-by-zero)", () => {
    expect(gaugeFillPercent(10, 0)).toBe(0);
    expect(gaugeFillPercent(10, -5)).toBe(0);
  });
});

describe("MfdGauge", () => {
  it("exposes an accessible meter with correct aria values", () => {
    render(<MfdGauge label="CARGO" value={128} max={256} unit="t" />);
    const meter = screen.getByRole("meter", { name: "CARGO" });
    expect(meter).toHaveAttribute("aria-valuenow", "128");
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "256");
  });

  it("renders the value and unit as text", () => {
    render(<MfdGauge label="FUEL" value={16} max={32} unit="t" />);
    expect(screen.getByText(/16/)).toBeInTheDocument();
    expect(screen.getByText(/t/)).toBeInTheDocument();
  });

  it("wires the computed fill percent to the bar width", () => {
    render(<MfdGauge label="CARGO" value={64} max={256} />);
    expect(screen.getByTestId("gauge-fill")).toHaveStyle({ width: "25%" });
  });

  it("clamps ARIA and the bar together when value exceeds max", () => {
    render(<MfdGauge label="CARGO" value={300} max={200} />);
    const meter = screen.getByRole("meter", { name: "CARGO" });
    expect(meter).toHaveAttribute("aria-valuenow", "200");
    expect(screen.getByTestId("gauge-fill")).toHaveStyle({ width: "100%" });
  });

  it("keeps ARIA coherent for a non-positive max (valuemax and valuenow both 0)", () => {
    render(<MfdGauge label="CARGO" value={5} max={0} />);
    const meter = screen.getByRole("meter", { name: "CARGO" });
    expect(meter).toHaveAttribute("aria-valuemax", "0");
    expect(meter).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByTestId("gauge-fill")).toHaveStyle({ width: "0%" });
  });
});
