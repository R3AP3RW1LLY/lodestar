// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { HotspotMarker } from "./geometry.js";
import { RingMap } from "./RingMap.js";
import { RingSchematic } from "./RingSchematic.js";

const HOTSPOTS: HotspotMarker[] = [
  { commodityId: "painite", count: 2, overlap: true },
  { commodityId: "platinum", count: 1 },
];

afterEach(cleanup);

describe("RingSchematic", () => {
  it("renders a labelled marker per hotspot", () => {
    render(<RingSchematic ringName="Paesia 2 A Ring" hotspots={HOTSPOTS} />);
    expect(screen.getByRole("img", { name: /ring map for Paesia 2 A Ring/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Painite ×2/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Platinum ×1/i })).toBeInTheDocument();
  });

  it("selects a marker on click (selection sync point)", () => {
    const onSelect = vi.fn();
    render(
      <RingSchematic ringName="R" hotspots={HOTSPOTS} onSelect={onSelect} selected="platinum" />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Painite ×2/i }));
    expect(onSelect).toHaveBeenCalledWith("painite");
    // The selected marker is marked pressed.
    expect(screen.getByRole("button", { name: /Platinum ×1/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("selects a marker via the keyboard", () => {
    const onSelect = vi.fn();
    render(<RingSchematic ringName="R" hotspots={HOTSPOTS} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /Painite ×2/i }), { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("painite");
  });

  it("renders an empty-ring state", () => {
    render(<RingSchematic ringName="R" hotspots={[]} />);
    expect(screen.getByText(/no hotspots/i)).toBeInTheDocument();
  });
});

describe("RingMap", () => {
  it("renders the 2D schematic when WebGL is unavailable (labelled fallback)", () => {
    render(<RingMap ringName="R" hotspots={HOTSPOTS} webglProbe={() => false} />);
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(document.querySelector('[data-renderer="2d"]')).not.toBeNull();
  });

  it("marks the 3D path as pending when WebGL is available (still renders the shared geometry today)", () => {
    render(<RingMap ringName="R" hotspots={HOTSPOTS} webglProbe={() => true} />);
    expect(document.querySelector('[data-renderer="3d-pending"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /Painite ×2/i })).toBeInTheDocument();
  });

  it("passes selection through to the schematic", () => {
    const onSelect = vi.fn();
    render(
      <RingMap ringName="R" hotspots={HOTSPOTS} onSelect={onSelect} webglProbe={() => false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Platinum ×1/i }));
    expect(onSelect).toHaveBeenCalledWith("platinum");
  });
});
