import type { Heatmap, TrendPoint } from "@lodestar/shared";

/**
 * Lightweight, dependency-free SVG/CSS visualisations for the Manifest (Step 3.5).
 * Recharts is deferred (not installed) in favour of these — they're fully testable
 * (values are asserted straight from the DOM), match the cockpit look, and add no
 * bundle weight. Richer Recharts charts are a straightforward later polish.
 */

/** A tiny inline sparkline of a numeric series (SVG polyline in a 0–1 viewbox). */
export function Sparkline({
  values,
  width = 120,
  height = 28,
}: {
  readonly values: readonly number[];
  readonly width?: number;
  readonly height?: number;
}): React.JSX.Element | null {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${String(Math.round(x))},${String(Math.round(y))}`;
    })
    .join(" ");
  return (
    <svg width={width} height={height} data-testid="sparkline" aria-hidden role="img">
      <polyline points={points} fill="none" stroke="#f5731b" strokeWidth={1.5} />
    </svg>
  );
}

/** A tons/hr trend line over sessions (chronological), as an SVG polyline + baseline. */
export function TrendChart({
  trend,
  height = 140,
}: {
  readonly trend: readonly TrendPoint[];
  readonly height?: number;
}): React.JSX.Element {
  if (trend.length < 2) {
    return (
      <p className="text-xs text-signal-skip" data-testid="trend-empty">
        Two or more sessions build a trend.
      </p>
    );
  }
  const width = 640;
  const values = trend.map((t) => t.tonsPerHour);
  const max = Math.max(...values, 1);
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - (v / max) * (height - 8) - 4;
      return `${String(Math.round(x))},${String(Math.round(y))}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className="h-36 w-full"
      preserveAspectRatio="none"
      data-testid="trend-chart"
      role="img"
      aria-label="Tons per hour trend"
    >
      <polyline points={points} fill="none" stroke="#f5731b" strokeWidth={2} />
    </svg>
  );
}

/** Interpolate an orange intensity for a 0–1 fraction (null cells render blank). */
function cellFill(value: number | null, max: number): string {
  if (value === null) return "transparent";
  const t = max > 0 ? value / max : 0;
  const alpha = 0.12 + Math.min(1, t) * 0.78;
  return `rgba(245,113,27,${alpha.toFixed(3)})`;
}

/** A ring×commodity / day×hour heat grid; null cells are visibly empty (not zero). */
export function HeatmapGrid({
  heatmap,
  label,
}: {
  readonly heatmap: Heatmap;
  readonly label: string;
}): React.JSX.Element {
  const flat = heatmap.cells.flat().filter((c): c is number => c !== null);
  const max = flat.length > 0 ? Math.max(...flat) : 0;
  if (heatmap.rows.length === 0) {
    return (
      <p className="text-xs text-signal-skip" data-testid="heatmap-empty">
        No data yet for {label}.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto" data-testid="heatmap">
      <table className="border-separate border-spacing-0.5 text-[10px]">
        <thead>
          <tr>
            <th className="pr-1" />
            {heatmap.cols.map((c) => (
              <th key={c} className="px-1 text-cyan-dim font-normal">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heatmap.rows.map((row, r) => (
            <tr key={row}>
              <td className="pr-1 text-right text-cyan-dim">{row}</td>
              {heatmap.cols.map((col, c) => {
                const value = heatmap.cells[r]?.[c] ?? null;
                return (
                  <td
                    key={col}
                    title={`${row} · ${col}: ${value === null ? "—" : String(Math.round(value))}`}
                    className="h-5 w-5 rounded-sm"
                    style={{ backgroundColor: cellFill(value, max) }}
                    data-empty={value === null ? "true" : "false"}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
