import { describe, expect, it } from "vitest";
import { DEFAULT_RING_GEOMETRY, commodityColor, layoutMarkers } from "./geometry.js";

describe("commodityColor", () => {
  it("is deterministic and distinct per commodity", () => {
    expect(commodityColor("painite")).toBe(commodityColor("painite"));
    expect(commodityColor("painite")).not.toBe(commodityColor("platinum"));
    expect(commodityColor("painite")).toMatch(/^hsl\(/);
  });
});

describe("layoutMarkers", () => {
  it("places markers evenly around the annulus, first at the top", () => {
    const markers = layoutMarkers([
      { commodityId: "painite", count: 1 },
      { commodityId: "platinum", count: 1 },
      { commodityId: "gold", count: 1 },
      { commodityId: "osmium", count: 1 },
    ]);
    const [cx, cy] = DEFAULT_RING_GEOMETRY.center;
    // Marker 0 is at −90° (top): cx unchanged, cy = center − ringRadius.
    expect(markers[0]?.cx).toBeCloseTo(cx);
    expect(markers[0]?.cy).toBeCloseTo(cy - DEFAULT_RING_GEOMETRY.ringRadius);
    // Even spacing: four markers ⇒ 90° apart.
    expect((markers[1]?.angleRad ?? 0) - (markers[0]?.angleRad ?? 0)).toBeCloseTo(Math.PI / 2);
    // Every marker sits on the ring radius.
    for (const m of markers) {
      const d = Math.hypot(m.cx - cx, m.cy - cy);
      expect(d).toBeCloseTo(DEFAULT_RING_GEOMETRY.ringRadius);
    }
  });

  it("sizes markers by hotspot count (clamped)", () => {
    const [one, three, huge] = layoutMarkers([
      { commodityId: "a", count: 1 },
      { commodityId: "b", count: 3 },
      { commodityId: "c", count: 99 },
    ]);
    expect(three?.radius ?? 0).toBeGreaterThan(one?.radius ?? 0);
    // Beyond maxCountForSize the size is clamped (99 caps at the max).
    const capRadius =
      DEFAULT_RING_GEOMETRY.markerBaseRadius +
      (DEFAULT_RING_GEOMETRY.maxCountForSize - 1) * DEFAULT_RING_GEOMETRY.perCountRadius;
    expect(huge?.radius).toBeCloseTo(capRadius);
  });

  it("carries color + overlap flags and handles an empty ring", () => {
    const [m] = layoutMarkers([{ commodityId: "painite", count: 2, overlap: true }]);
    expect(m?.color).toBe(commodityColor("painite"));
    expect(m?.overlap).toBe(true);
    expect(layoutMarkers([])).toEqual([]);
  });
});
