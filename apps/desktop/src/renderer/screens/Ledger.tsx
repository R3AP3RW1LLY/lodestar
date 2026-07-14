import { useEffect, useState } from "react";
import type {
  AlertRuleRequest,
  LedgerAlertRule,
  LedgerBoardEntry,
  LedgerStation,
  LedgerTrendPoint,
} from "@lodestar/shared";
import { ScreenHeader } from "../components/ScreenHeader.js";
import { MfdPanel } from "../components/MfdPanel.js";
import {
  AlertManager,
  CommodityBoard,
  LedgerTrend,
  StationTable,
} from "../components/ledger/panels.js";

const TREND_BUCKET_MS = 24 * 60 * 60 * 1000; // daily buckets

/**
 * The Ledger — market intelligence (SSOT Step 4.11c). Shows the best sell station per
 * commodity (the board), and for a selected commodity the ranked stations (with SOURCE +
 * DATA-AGE on every price) plus a price trend. The alert manager creates/toggles/deletes
 * price-threshold + cargo-full rules. Data flows over IPC from the Step-4.11b ledger
 * service + alert engine. Deck design language (ScreenHeader + glass panels).
 */
export function Ledger(): React.JSX.Element {
  const [board, setBoard] = useState<readonly LedgerBoardEntry[]>([]);
  const [alerts, setAlerts] = useState<readonly LedgerAlertRule[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [stations, setStations] = useState<readonly LedgerStation[]>([]);
  const [trend, setTrend] = useState<readonly LedgerTrendPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([window.lodestar.getLedgerBoard(), window.lodestar.listAlerts()])
      .then(([b, a]) => {
        if (cancelled) return;
        setBoard(b);
        setAlerts(a);
        setStatus("ready");
        if (b.length > 0) setSelected(b[0]?.commodityId ?? null);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (selected === null) return;
    let cancelled = false;
    Promise.all([
      window.lodestar.getLedgerStations({ commodityId: selected }),
      window.lodestar.getLedgerTrend({ commodityId: selected, bucketMs: TREND_BUCKET_MS }),
    ])
      .then(([s, t]) => {
        if (cancelled) return;
        setStations(s);
        setTrend(t);
      })
      .catch(() => {
        if (!cancelled) {
          setStations([]);
          setTrend([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const refreshAlerts = (next: readonly LedgerAlertRule[]): void => {
    setAlerts(next);
  };
  const addAlert = (request: AlertRuleRequest): void => {
    window.lodestar
      .addAlert(request)
      .then(refreshAlerts)
      .catch(() => undefined);
  };
  const toggleAlert = (id: number, enabled: boolean): void => {
    window.lodestar
      .setAlertEnabled({ id, enabled })
      .then(refreshAlerts)
      .catch(() => undefined);
  };
  const deleteAlert = (id: number): void => {
    window.lodestar
      .deleteAlert({ id })
      .then(refreshAlerts)
      .catch(() => undefined);
  };

  const trailing =
    status === "error" ? (
      <span className="text-signal-danger">ledger unavailable</span>
    ) : (
      <span className="text-cyan-dim">{board.length} commodities</span>
    );

  return (
    <div className="space-y-4">
      <ScreenHeader eyebrow="Market" title="Ledger" trailing={trailing} />
      {status === "loading" && <MfdPanel title="Ledger">Loading market data…</MfdPanel>}
      {status === "error" && (
        <MfdPanel title="Ledger">
          <p className="p-2 text-signal-danger">Could not load the ledger.</p>
        </MfdPanel>
      )}
      {status === "ready" && board.length === 0 && (
        <MfdPanel title="Ledger">
          <p className="p-2 text-signal-skip">
            No market data yet — prices arrive as you dock (Market.json) and from the EDDN feed.
          </p>
        </MfdPanel>
      )}
      {status === "ready" && board.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <div className="space-y-4">
            <CommodityBoard board={board} selected={selected} onSelect={setSelected} />
            <AlertManager
              alerts={alerts}
              onAdd={addAlert}
              onToggle={toggleAlert}
              onDelete={deleteAlert}
            />
          </div>
          <div className="space-y-4">
            {selected !== null && <StationTable commodityId={selected} stations={stations} />}
            <LedgerTrend points={trend} />
          </div>
        </div>
      )}
    </div>
  );
}
