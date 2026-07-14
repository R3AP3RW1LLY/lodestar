import { useEffect, useState } from "react";
import type { ManifestData, SessionDetail } from "@lodestar/shared";
import { ScreenHeader } from "../components/ScreenHeader.js";
import { MfdPanel } from "../components/MfdPanel.js";
import {
  BreakdownsPanel,
  EfficiencyPanel,
  ManifestKpis,
  PersonalBestsBoard,
} from "../components/manifest/panels.js";
import { HeatmapGrid, TrendChart } from "../components/manifest/charts.js";
import { SessionTable } from "../components/manifest/SessionTable.js";
import { SessionDetailPanel } from "../components/manifest/SessionDetailPanel.js";
import { ExportButtons } from "../components/manifest/ExportButtons.js";

/**
 * The Manifest — deep session analytics (SSOT Step 3.5). Pulls the full analytics
 * bundle over IPC (`getManifest`) on mount, then renders every Phase-3 data feature:
 * KPI totals, personal-best board, the session history (with a tons/hr sparkline +
 * click-to-drill-down), trend line, the day×hour + ring×commodity heatmaps, per-ring/
 * commodity/ship breakdowns + best pairings, limpet + time-split efficiency, and CSV
 * export. The zero-session first-run state is designed explicitly. Deck design
 * language (ScreenHeader + glass) so it reads as one surface with the rest of the app.
 */
export function Manifest(): React.JSX.Element {
  const [data, setData] = useState<ManifestData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.lodestar
      .getManifest({})
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setStatus("ready");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onSelect = (id: number): void => {
    setSelectedId(id);
    window.lodestar
      .getSessionDetail(id)
      .then(setDetail)
      .catch(() => {
        setDetail(null);
      });
  };

  const container = "mx-auto flex max-w-6xl flex-col gap-5 p-5";

  if (status === "loading") {
    return (
      <div className={container} data-testid="manifest-screen">
        <ScreenHeader title="Manifest" />
        <MfdPanel title="Loading">
          <p className="text-sm text-cyan" data-testid="manifest-loading">
            Reading your mining history…
          </p>
        </MfdPanel>
      </div>
    );
  }

  if (status === "error" || data === null) {
    return (
      <div className={container} data-testid="manifest-screen">
        <ScreenHeader title="Manifest" />
        <MfdPanel title="Unavailable">
          <p className="text-sm text-signal-danger" data-testid="manifest-error">
            Could not load analytics. Configure your journal in Settings and mine a session.
          </p>
        </MfdPanel>
      </div>
    );
  }

  if (data.sessions.length === 0) {
    return (
      <div className={container} data-testid="manifest-screen">
        <ScreenHeader title="Manifest" />
        <MfdPanel title="No sessions yet">
          <p className="text-sm text-cyan" data-testid="manifest-empty">
            The Manifest fills in as you mine. Complete a mining session — prospect, refine, and
            sell — and your history, trends, heatmaps, and personal bests appear here.
          </p>
        </MfdPanel>
      </div>
    );
  }

  return (
    <div className={container} data-testid="manifest-screen">
      <ScreenHeader title="Manifest" trailing={<ExportButtons />} />

      <ManifestKpis aggregate={data.aggregate} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <SessionTable sessions={data.sessions} selectedId={selectedId} onSelect={onSelect} />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-4">
          <PersonalBestsBoard bests={data.personalBests} />
        </div>
      </div>

      <SessionDetailPanel detail={detail} />

      <MfdPanel title="Tons/hr trend">
        <TrendChart trend={data.trend} />
      </MfdPanel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <MfdPanel title="Productivity — day × hour (UTC)">
          <HeatmapGrid heatmap={data.heatmaps.timeProductivity} label="time productivity" />
        </MfdPanel>
        <MfdPanel title="Yield — ring × commodity">
          <HeatmapGrid heatmap={data.heatmaps.ringCommodityYield} label="ring yield" />
        </MfdPanel>
      </div>

      <BreakdownsPanel breakdowns={data.breakdowns} />
      <EfficiencyPanel efficiency={data.efficiency} />
    </div>
  );
}
