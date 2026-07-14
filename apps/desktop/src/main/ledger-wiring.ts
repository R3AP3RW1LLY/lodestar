/**
 * Ledger + alerts main-process bridge (SSOT Step 4.11c). Adapts the `@lodestar/core`
 * ledger service + alert engine to the IPC DTOs the renderer consumes. Read side: the
 * best station per commodity, ranked stations for one commodity (with source + age), and
 * the price trend. Alert side: rule CRUD, each returning the full updated list. Returning
 * the shared DTO types compile-enforces the core → shared shape match at this boundary.
 *
 * Live alert EVALUATION (price/cargo → fire → notification + TTS) is wired into the engine
 * separately; this bridge is the UI's read + rule-management surface.
 */

import type { Db } from "@lodestar/data";
import { createAlertEngine, createLedgerService } from "@lodestar/core";
import type { AlertEngine, FiredAlert } from "@lodestar/core";
import type {
  AlertRuleRequest,
  LedgerAlertRule,
  LedgerBoardEntry,
  LedgerStation,
  LedgerStationQuery,
  LedgerTrendPoint,
  LedgerTrendQuery,
} from "@lodestar/shared";

export interface LedgerBridge {
  board: () => readonly LedgerBoardEntry[];
  stations: (query: LedgerStationQuery) => readonly LedgerStation[];
  trend: (query: LedgerTrendQuery) => readonly LedgerTrendPoint[];
  listAlerts: () => readonly LedgerAlertRule[];
  addAlert: (request: AlertRuleRequest) => readonly LedgerAlertRule[];
  setAlertEnabled: (id: number, enabled: boolean) => readonly LedgerAlertRule[];
  deleteAlert: (id: number) => readonly LedgerAlertRule[];
  /** The alert engine, exposed so the live wiring can evaluate price/cargo signals. */
  readonly engine: AlertEngine;
}

function stationFilter(query: LedgerStationQuery): {
  minPad?: "S" | "M" | "L";
  maxDistanceLs?: number;
  minDemand?: number;
} {
  return {
    ...(query.minPad === undefined ? {} : { minPad: query.minPad }),
    ...(query.maxDistanceLs === undefined ? {} : { maxDistanceLs: query.maxDistanceLs }),
    ...(query.minDemand === undefined ? {} : { minDemand: query.minDemand }),
  };
}

export function createLedgerBridge(
  db: Db,
  now: () => number,
  nowIso: () => string,
  emit: (alert: FiredAlert) => void,
): LedgerBridge {
  const ledger = createLedgerService(db, now);
  const engine = createAlertEngine(db, emit);

  return {
    board: () =>
      ledger.board().map((entry) => ({
        commodityId: entry.commodityId,
        best: entry.best ?? null,
      })),
    stations: (query) => ledger.bestStations(query.commodityId, stationFilter(query)),
    trend: (query) => ledger.trend(query.commodityId, query.bucketMs),
    listAlerts: () => engine.listRules(),
    addAlert: (request) => {
      engine.addRule(request, nowIso());
      return engine.listRules();
    },
    setAlertEnabled: (id, enabled) => {
      engine.setEnabled(id, enabled);
      return engine.listRules();
    },
    deleteAlert: (id) => {
      engine.deleteRule(id);
      return engine.listRules();
    },
    engine,
  };
}

/** Empty bridge for when there is no database (unconfigured / open failed). */
export function emptyLedgerBridge(): Pick<
  LedgerBridge,
  "board" | "stations" | "trend" | "listAlerts" | "addAlert" | "setAlertEnabled" | "deleteAlert"
> {
  const empty: readonly LedgerAlertRule[] = [];
  return {
    board: () => [],
    stations: () => [],
    trend: () => [],
    listAlerts: () => empty,
    addAlert: () => empty,
    setAlertEnabled: () => empty,
    deleteAlert: () => empty,
  };
}
