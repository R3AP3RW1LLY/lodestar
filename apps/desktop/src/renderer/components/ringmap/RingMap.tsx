import { useMemo } from "react";
import type { HotspotMarker } from "./geometry.js";
import { RingSchematic } from "./RingSchematic.js";
import { hasWebGL } from "./webgl.js";

/**
 * Ring map container (SSOT Step 4.14). Chooses the renderer by GPU capability: a
 * hardware-accelerated WebGL context → the 3D scene; otherwise the labelled 2D schematic
 * (a real fallback). The 3D react-three-fiber `Canvas` (ring annulus, orbit/zoom, markers
 * sized-by-count / coloured-by-commodity, overlap highlights, pixel-ratio clamp for weak
 * GPUs) is a deliberate follow-up gated on adding the `three` + `@react-three/fiber`
 * dependency and the manual fps check (§4.2 manual-verification; 3D can't run in CI/jsdom).
 * It NEVER touches CUDA — it renders on whatever GPU the OS gives Electron. Until then this
 * container renders the schematic, which shares the same `layoutMarkers` geometry, so the
 * 3D scene drops in without changing selection or placement behaviour.
 */
export function RingMap({
  ringName,
  hotspots,
  selected,
  onSelect,
  webglProbe = hasWebGL,
}: {
  readonly ringName: string;
  readonly hotspots: readonly HotspotMarker[];
  readonly selected?: string;
  readonly onSelect?: (commodityId: string) => void;
  /** Injectable for tests; the 3D path is not yet built, so both branches render 2D today. */
  readonly webglProbe?: () => boolean;
}): React.JSX.Element {
  const gpu = useMemo(() => webglProbe(), [webglProbe]);
  return (
    <div data-renderer={gpu ? "3d-pending" : "2d"}>
      <RingSchematic
        ringName={ringName}
        hotspots={hotspots}
        {...(selected === undefined ? {} : { selected })}
        {...(onSelect === undefined ? {} : { onSelect })}
      />
    </div>
  );
}
