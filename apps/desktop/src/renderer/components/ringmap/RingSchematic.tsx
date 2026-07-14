import { commodityById } from "@lodestar/shared";
import type { HotspotMarker } from "./geometry.js";
import { DEFAULT_RING_GEOMETRY, layoutMarkers } from "./geometry.js";

const displayName = (id: string): string => commodityById(id)?.displayName ?? id;

/**
 * The 2D ring schematic (SSOT Step 4.14) — a real, always-available SVG view of a ring's
 * hotspots (annulus + markers sized by signal count, coloured per commodity, overlaps
 * ringed), clickable to select. It's both the labelled fallback when WebGL is unavailable
 * AND the headlessly-testable twin of the 3D scene (shared `layoutMarkers` geometry).
 */
export function RingSchematic({
  ringName,
  hotspots,
  selected,
  onSelect,
}: {
  readonly ringName: string;
  readonly hotspots: readonly HotspotMarker[];
  readonly selected?: string;
  readonly onSelect?: (commodityId: string) => void;
}): React.JSX.Element {
  const [cx, cy] = DEFAULT_RING_GEOMETRY.center;
  const markers = layoutMarkers(hotspots);
  return (
    <figure className="m-0">
      <svg
        viewBox="0 0 100 100"
        className="h-64 w-full"
        role="img"
        aria-label={`ring map for ${ringName}`}
      >
        {/* The ring annulus. */}
        <circle
          cx={cx}
          cy={cy}
          r={DEFAULT_RING_GEOMETRY.ringRadius}
          fill="none"
          stroke="#243040"
          strokeWidth={6}
        />
        <circle
          cx={cx}
          cy={cy}
          r={DEFAULT_RING_GEOMETRY.ringRadius}
          fill="none"
          stroke="#0d1420"
          strokeWidth={2}
        />
        {markers.map((m) => {
          const isSelected = m.commodityId === selected;
          return (
            <g key={m.commodityId}>
              {m.overlap && (
                <circle
                  cx={m.cx}
                  cy={m.cy}
                  r={m.radius + 1.6}
                  fill="none"
                  stroke="#39d353"
                  strokeWidth={0.6}
                />
              )}
              <circle
                cx={m.cx}
                cy={m.cy}
                r={m.radius}
                fill={m.color}
                stroke={isSelected ? "#FF7100" : "#0a0a0f"}
                strokeWidth={isSelected ? 1.4 : 0.5}
                role="button"
                aria-label={`${displayName(m.commodityId)} ×${String(m.count)}`}
                aria-pressed={isSelected}
                tabIndex={0}
                style={{ cursor: onSelect === undefined ? "default" : "pointer" }}
                onClick={() => onSelect?.(m.commodityId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") onSelect?.(m.commodityId);
                }}
              />
            </g>
          );
        })}
        {markers.length === 0 && (
          <text x={cx} y={cy} textAnchor="middle" className="fill-signal-skip text-[6px]">
            no hotspots
          </text>
        )}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-2 text-[10px] text-cyan-dim">
        {markers.map((m) => (
          <span key={m.commodityId} className="flex items-center gap-1">
            <span className="inline-block h-2 w-2" style={{ background: m.color }} />
            {displayName(m.commodityId)} ×{m.count}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
