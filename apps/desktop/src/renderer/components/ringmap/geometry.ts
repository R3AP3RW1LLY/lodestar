/**
 * Ring-map scene geometry (SSOT Step 4.14, pure + headlessly testable). Places hotspot
 * markers around a ring annulus — evenly spaced by index, sized by hotspot count, colored
 * deterministically per commodity — so the same layout math drives BOTH the 3D scene and
 * the 2D fallback schematic. No React, no WebGL: just the numbers, unit-tested headlessly.
 */

export interface HotspotMarker {
  readonly commodityId: string;
  readonly count: number;
  readonly overlap?: boolean;
}

export interface RingGeometry {
  readonly center: readonly [number, number];
  readonly ringRadius: number;
  readonly markerBaseRadius: number;
  /** Per extra hotspot in the signal (count), add this to the marker radius (capped). */
  readonly perCountRadius: number;
  readonly maxCountForSize: number;
}

export const DEFAULT_RING_GEOMETRY: RingGeometry = {
  center: [50, 50],
  ringRadius: 34,
  markerBaseRadius: 2.5,
  perCountRadius: 1.4,
  maxCountForSize: 4,
};

export interface MarkerPlacement {
  readonly commodityId: string;
  readonly count: number;
  readonly angleRad: number;
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  readonly color: string;
  readonly overlap: boolean;
}

/** A small stable hash → hue, so every commodity gets a consistent, distinct colour. */
export function commodityColor(commodityId: string): string {
  let hash = 0;
  for (let i = 0; i < commodityId.length; i++) {
    hash = (hash * 31 + commodityId.charCodeAt(i)) % 360;
  }
  return `hsl(${String(hash)}, 72%, 58%)`;
}

/**
 * Lay out the hotspot markers around the annulus. Markers start at the top (−90°) and
 * spread evenly clockwise; size grows with signal count (clamped). Deterministic — a given
 * hotspot list always yields the same placements.
 */
export function layoutMarkers(
  hotspots: readonly HotspotMarker[],
  geometry: RingGeometry = DEFAULT_RING_GEOMETRY,
): MarkerPlacement[] {
  const n = hotspots.length;
  const [cx0, cy0] = geometry.center;
  return hotspots.map((hotspot, i) => {
    const angleRad = (i / Math.max(n, 1)) * 2 * Math.PI - Math.PI / 2;
    const clampedCount = Math.min(Math.max(hotspot.count, 1), geometry.maxCountForSize);
    return {
      commodityId: hotspot.commodityId,
      count: hotspot.count,
      angleRad,
      cx: cx0 + geometry.ringRadius * Math.cos(angleRad),
      cy: cy0 + geometry.ringRadius * Math.sin(angleRad),
      radius: geometry.markerBaseRadius + (clampedCount - 1) * geometry.perCountRadius,
      color: commodityColor(hotspot.commodityId),
      overlap: hotspot.overlap ?? false,
    };
  });
}
