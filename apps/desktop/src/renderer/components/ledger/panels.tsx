import type {
  AlertRuleRequest,
  LedgerAlertRule,
  LedgerBoardEntry,
  LedgerStation,
  LedgerTrendPoint,
} from "@lodestar/shared";
import { commodityById } from "@lodestar/shared";
import { useState } from "react";
import { MfdPanel } from "../MfdPanel.js";
import { DataAgeBadge } from "../DataAgeBadge.js";
import { fmtCredits, fmtInt } from "../../format.js";

const displayName = (commodityId: string): string =>
  commodityById(commodityId)?.displayName ?? commodityId;

/** The commodity board: best sell station per commodity, click to drill in. */
export function CommodityBoard({
  board,
  selected,
  onSelect,
}: {
  readonly board: readonly LedgerBoardEntry[];
  readonly selected: string | null;
  readonly onSelect: (commodityId: string) => void;
}): React.JSX.Element {
  return (
    <MfdPanel title="Commodity Board">
      <ul className="divide-y divide-white/5">
        {board.map((entry) => {
          const active = entry.commodityId === selected;
          return (
            <li key={entry.commodityId}>
              <button
                type="button"
                onClick={() => {
                  onSelect(entry.commodityId);
                }}
                className={`flex w-full items-center justify-between px-2 py-2 text-left text-sm ${active ? "bg-elite-orange/10" : "hover:bg-white/5"}`}
              >
                <span className="font-display uppercase tracking-wide">
                  {displayName(entry.commodityId)}
                </span>
                <span className="flex items-center gap-2 font-mono">
                  {entry.best === null ? (
                    <span className="text-signal-skip">no data</span>
                  ) : (
                    <>
                      <span className="text-elite-orange">{fmtCredits(entry.best.sellPrice)}</span>
                      <DataAgeBadge timestamp={entry.best.sourceTsMs} source={entry.best.source} />
                    </>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </MfdPanel>
  );
}

/** The station ranking for one commodity — source + data-age on every row. */
export function StationTable({
  commodityId,
  stations,
}: {
  readonly commodityId: string;
  readonly stations: readonly LedgerStation[];
}): React.JSX.Element {
  return (
    <MfdPanel title={`Best Sell — ${displayName(commodityId)}`}>
      {stations.length === 0 ? (
        <p className="p-2 text-sm text-signal-skip">
          No market observations for this commodity yet.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-widest text-cyan-dim">
            <tr>
              <th className="px-2 py-1 text-left">Station</th>
              <th className="px-2 py-1 text-right">Sell</th>
              <th className="px-2 py-1 text-right">Demand</th>
              <th className="px-2 py-1 text-left">Pad</th>
              <th className="px-2 py-1 text-left">Source · Age</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {stations.map((s) => (
              <tr key={s.marketId} className="border-t border-white/5">
                <td className="px-2 py-1">
                  <span className="font-display">{s.stationName}</span>
                  <span className="ml-2 text-cyan-dim">{s.systemName}</span>
                </td>
                <td className="px-2 py-1 text-right text-elite-orange">
                  {fmtCredits(s.sellPrice)}
                </td>
                <td className="px-2 py-1 text-right">{fmtInt(s.demand)}</td>
                <td className="px-2 py-1">{s.padSize ?? "—"}</td>
                <td className="px-2 py-1">
                  <span className="mr-2 uppercase text-cyan-dim">{s.source}</span>
                  <DataAgeBadge timestamp={s.sourceTsMs} source={s.source} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </MfdPanel>
  );
}

/** A minimal SVG price-trend sparkline (avg sell over time buckets). */
export function LedgerTrend({
  points,
}: {
  readonly points: readonly LedgerTrendPoint[];
}): React.JSX.Element {
  return (
    <MfdPanel title="Price Trend">
      {points.length < 2 ? (
        <p className="p-2 text-sm text-signal-skip">Not enough history to chart a trend yet.</p>
      ) : (
        <TrendSvg points={points} />
      )}
    </MfdPanel>
  );
}

function TrendSvg({ points }: { readonly points: readonly LedgerTrendPoint[] }): React.JSX.Element {
  const w = 320;
  const h = 80;
  const prices = points.map((p) => p.avgSellPrice);
  const max = Math.max(...prices);
  const min = Math.min(...prices);
  const span = max - min || 1;
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((p.avgSellPrice - min) / span) * h;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${String(w)} ${String(h)}`}
      className="h-24 w-full"
      role="img"
      aria-label="price trend"
    >
      <path d={path} fill="none" stroke="#FF7100" strokeWidth={1.5} />
    </svg>
  );
}

/** Alert rule manager: list + add (price/cargo) + enable toggle + delete. */
export function AlertManager({
  alerts,
  onAdd,
  onToggle,
  onDelete,
}: {
  readonly alerts: readonly LedgerAlertRule[];
  readonly onAdd: (request: AlertRuleRequest) => void;
  readonly onToggle: (id: number, enabled: boolean) => void;
  readonly onDelete: (id: number) => void;
}): React.JSX.Element {
  const [kind, setKind] = useState<"price-threshold" | "cargo-full">("price-threshold");
  const [commodityId, setCommodityId] = useState("painite");
  const [threshold, setThreshold] = useState("500000");
  const [direction, setDirection] = useState<"above" | "below">("above");

  const submit = (): void => {
    const value = Number(threshold);
    if (!Number.isFinite(value)) return;
    onAdd(
      kind === "price-threshold"
        ? { kind, commodityId, threshold: value, direction }
        : { kind, threshold: value },
    );
  };

  return (
    <MfdPanel title="Alerts">
      <div className="flex flex-wrap items-end gap-2 p-2">
        <label className="text-xs text-cyan-dim">
          Kind
          <select
            aria-label="alert kind"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value === "cargo-full" ? "cargo-full" : "price-threshold");
            }}
            className="ml-1 bg-black/40 px-1 py-0.5 text-sm text-white"
          >
            <option value="price-threshold">Price</option>
            <option value="cargo-full">Cargo full %</option>
          </select>
        </label>
        {kind === "price-threshold" && (
          <label className="text-xs text-cyan-dim">
            Commodity
            <input
              aria-label="alert commodity"
              value={commodityId}
              onChange={(e) => {
                setCommodityId(e.target.value);
              }}
              className="ml-1 w-28 bg-black/40 px-1 py-0.5 text-sm text-white"
            />
          </label>
        )}
        <label className="text-xs text-cyan-dim">
          Threshold
          <input
            aria-label="alert threshold"
            value={threshold}
            onChange={(e) => {
              setThreshold(e.target.value);
            }}
            className="ml-1 w-24 bg-black/40 px-1 py-0.5 text-sm text-white"
          />
        </label>
        {kind === "price-threshold" && (
          <label className="text-xs text-cyan-dim">
            When
            <select
              aria-label="alert direction"
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value === "below" ? "below" : "above");
              }}
              className="ml-1 bg-black/40 px-1 py-0.5 text-sm text-white"
            >
              <option value="above">Above</option>
              <option value="below">Below</option>
            </select>
          </label>
        )}
        <button
          type="button"
          onClick={submit}
          className="clip-mfd border border-elite-orange/60 px-2 py-1 text-xs uppercase tracking-widest text-elite-orange hover:bg-elite-orange/10"
        >
          Add rule
        </button>
      </div>
      <ul className="divide-y divide-white/5">
        {alerts.map((rule) => (
          <li key={rule.id} className="flex items-center justify-between px-2 py-1.5 text-sm">
            <span className="font-mono">
              {rule.kind === "cargo-full"
                ? `Cargo ≥ ${String(rule.threshold)}%`
                : `${displayName(rule.commodityId ?? "")} ${rule.direction} ${fmtCredits(rule.threshold)}`}
            </span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                aria-label={`toggle rule ${String(rule.id)}`}
                onClick={() => {
                  onToggle(rule.id, !rule.enabled);
                }}
                className={`clip-mfd border px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${rule.enabled ? "border-signal-ok/60 text-signal-ok" : "border-signal-skip/50 text-signal-skip"}`}
              >
                {rule.enabled ? "On" : "Off"}
              </button>
              <button
                type="button"
                aria-label={`delete rule ${String(rule.id)}`}
                onClick={() => {
                  onDelete(rule.id);
                }}
                className="text-signal-danger hover:underline"
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
    </MfdPanel>
  );
}
