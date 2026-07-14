import { useEffect, useMemo, useState } from "react";
import type { VeinCandidate, VeinFilter } from "@lodestar/shared";
import { commodityById } from "@lodestar/shared";
import { ScreenHeader } from "../components/ScreenHeader.js";
import { MfdPanel } from "../components/MfdPanel.js";
import { DataAgeBadge } from "../components/DataAgeBadge.js";
import { fmtCredits, fmtInt, fmtNum } from "../format.js";
import { navigateTo } from "../nav.js";

const RESERVES = ["Pristine", "Major", "Common", "Low", "Depleted"];
const RING_TYPES = ["Metallic", "MetalRich", "Rocky", "Icy"];
const displayName = (id: string): string => commodityById(id)?.displayName ?? id;

/**
 * The Vein Finder (SSOT Step 4.13) — the hotspot-intelligence screen. A ranked list of
 * scored hotspots with the full Step-4.5 "why" breakdown, composable filters (commodity,
 * max distance, reserve, ring type, pad), honest overlap badges (confirmed vs "possible —
 * verify in ring"), data-age + provenance, a seed-only first-run state, and a "Plan this"
 * handoff to the Cartographer. Data + scoring come over IPC from the Step-4.13 vein service.
 */
export function VeinFinder({
  onPlan = (commodityId: string): void => {
    navigateTo("cartographer");
    void commodityId;
  },
}: {
  readonly onPlan?: (commodityId: string) => void;
} = {}): React.JSX.Element {
  const [filter, setFilter] = useState<VeinFilter>({});
  const [veins, setVeins] = useState<readonly VeinCandidate[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    window.lodestar
      .findVeins(filter)
      .then((v) => {
        if (cancelled) return;
        setVeins(v);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [filter]);

  const seedOnly = useMemo(
    () => veins.length > 0 && veins.every((v) => v.source === "seed"),
    [veins],
  );

  // A value of undefined CLEARS that filter (dropped, not set to undefined — the DTO's
  // optional keys must be absent, not `undefined`, under exactOptionalPropertyTypes).
  const patch = (p: Record<string, string | number | undefined>): void => {
    setFilter((prev) => {
      const merged: Record<string, string | number | undefined> = { ...prev, ...p };
      const result: Record<string, string | number> = {};
      for (const key of Object.keys(merged)) {
        const value = merged[key];
        if (value !== undefined) result[key] = value;
      }
      return result;
    });
  };

  return (
    <div className="space-y-4">
      <ScreenHeader
        eyebrow="Prospector"
        title="Vein Finder"
        trailing={<span className="text-cyan-dim">{veins.length} rings</span>}
      />
      <FilterBar filter={filter} onChange={patch} />
      {status === "loading" && <MfdPanel title="Vein Finder">Scoring hotspots…</MfdPanel>}
      {status === "error" && (
        <MfdPanel title="Vein Finder">
          <p className="p-2 text-signal-danger">Could not load hotspots.</p>
        </MfdPanel>
      )}
      {status === "ready" && veins.length === 0 && (
        <MfdPanel title="Vein Finder">
          <p className="p-2 text-signal-skip">
            No hotspots match — DSS-map a ring (or widen the filters) and it appears here.
          </p>
        </MfdPanel>
      )}
      {seedOnly && (
        <p className="px-1 text-xs text-signal-warn">
          Showing seed data (community common knowledge) — scan rings to add your own confirmed
          hotspots.
        </p>
      )}
      {status === "ready" &&
        veins.map((vein) => (
          <VeinCard
            key={`${vein.ringName}-${vein.commodityId}`}
            vein={vein}
            onPlan={() => {
              onPlan(vein.commodityId);
            }}
          />
        ))}
    </div>
  );
}

function FilterBar({
  filter,
  onChange,
}: {
  readonly filter: VeinFilter;
  readonly onChange: (p: Record<string, string | number | undefined>) => void;
}): React.JSX.Element {
  const num = (v: string): number | undefined => {
    const n = Number(v);
    return v === "" || !Number.isFinite(n) ? undefined : n;
  };
  return (
    <MfdPanel title="Filters">
      <div className="flex flex-wrap items-end gap-3 p-2 text-xs text-cyan-dim">
        <label>
          Commodity
          <input
            aria-label="filter commodity"
            value={filter.commodityId ?? ""}
            onChange={(e) => {
              onChange({ commodityId: e.target.value === "" ? undefined : e.target.value });
            }}
            className="ml-1 w-28 bg-black/40 px-1 py-0.5 text-sm text-white"
          />
        </label>
        <label>
          Max distance (ly)
          <input
            aria-label="filter max distance"
            value={filter.maxDistanceLy ?? ""}
            onChange={(e) => {
              onChange({ maxDistanceLy: num(e.target.value) });
            }}
            className="ml-1 w-20 bg-black/40 px-1 py-0.5 text-sm text-white"
          />
        </label>
        <SelectFilter
          label="Reserve"
          aria="filter reserve"
          value={filter.reserve ?? ""}
          options={RESERVES}
          onPick={(v) => {
            onChange({ reserve: v });
          }}
        />
        <SelectFilter
          label="Ring type"
          aria="filter ring type"
          value={filter.ringType ?? ""}
          options={RING_TYPES}
          onPick={(v) => {
            onChange({ ringType: v });
          }}
        />
        <SelectFilter
          label="Min pad"
          aria="filter min pad"
          value={filter.minPad ?? ""}
          options={["S", "M", "L"]}
          onPick={(v) => {
            onChange({ minPad: v });
          }}
        />
      </div>
    </MfdPanel>
  );
}

function SelectFilter({
  label,
  aria,
  value,
  options,
  onPick,
}: {
  readonly label: string;
  readonly aria: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onPick: (value: string | undefined) => void;
}): React.JSX.Element {
  return (
    <label>
      {label}
      <select
        aria-label={aria}
        value={value}
        onChange={(e) => {
          onPick(e.target.value === "" ? undefined : e.target.value);
        }}
        className="ml-1 bg-black/40 px-1 py-0.5 text-sm text-white"
      >
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function VeinCard({
  vein,
  onPlan,
}: {
  readonly vein: VeinCandidate;
  readonly onPlan: () => void;
}): React.JSX.Element {
  const b = vein.breakdown;
  return (
    <MfdPanel title={`${displayName(vein.commodityId)} — ${vein.ringName}`}>
      <div className="flex flex-wrap items-center gap-2 px-2 pt-2 text-sm">
        <span className="font-mono text-elite-orange">score {fmtInt(vein.score)}</span>
        <span className="text-cyan-dim">{vein.systemName}</span>
        {vein.ringType !== null && <Tag>{vein.ringType}</Tag>}
        {vein.reserve !== null && <Tag>{vein.reserve}</Tag>}
        <span className="text-cyan-dim">×{fmtInt(vein.hotspotCount)}</span>
        {vein.overlap === "confirmed" && (
          <span className="clip-mfd border border-signal-ok/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-signal-ok">
            overlap ✓
          </span>
        )}
        {vein.overlap === "candidate" && (
          <span
            title={`possible overlap: ${vein.overlapCommodities.join(", ")}`}
            className="clip-mfd border border-signal-warn/60 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-signal-warn"
          >
            possible — verify in ring
          </span>
        )}
        <span className="uppercase text-cyan-dim">{vein.source}</span>
        <DataAgeBadge timestamp={vein.updatedAtMs} source={vein.source} />
      </div>
      <div className="px-2 py-1 text-sm">
        {vein.sellStation === null ? (
          <span className="text-signal-skip">no known sell price</span>
        ) : (
          <>
            Sell {vein.sellStation}, {vein.sellSystem} @{" "}
            <span className="text-elite-orange">{fmtCredits(vein.sellPrice)}</span>
          </>
        )}
        {vein.distanceLy !== null && (
          <span className="text-cyan-dim"> · {fmtNum(vein.distanceLy)} ly away</span>
        )}
      </div>
      {/* Why this score — the exact Step-4.5 terms. */}
      <p className="px-2 pb-1 font-mono text-[11px] text-cyan-dim">
        why: {fmtCredits(b.price)} × {fmtNum(b.overlapMultiplier, 2)} × {fmtNum(b.reserveWeight, 2)}{" "}
        × {fmtNum(b.ringMatch, 2)} − {fmtInt(b.distancePenalty)} − {fmtInt(b.sellLegPenalty)} ={" "}
        {fmtInt(b.score)}
      </p>
      <div className="p-2">
        <button
          type="button"
          onClick={onPlan}
          className="clip-mfd border border-elite-orange/60 px-2 py-1 text-xs uppercase tracking-widest text-elite-orange hover:bg-elite-orange/10"
        >
          Plan this
        </button>
      </div>
    </MfdPanel>
  );
}

function Tag({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="clip-mfd border border-cyan-dim/40 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-cyan-dim">
      {children}
    </span>
  );
}
