/**
 * Ledger IPC DTOs (SSOT Step 4.11c). The shapes that cross the IPC boundary between the
 * main-process ledger service / alert engine and the renderer — so they live in `shared`
 * (the one package both sides may depend on). Structurally aligned with the core /
 * intelligence result types; the main handler maps to these so any drift is a boundary
 * type error.
 */

export type AlertKind = "price-threshold" | "cargo-full";
export type AlertDirection = "above" | "below";

/** A ranked sell station for the Ledger board/table (carries source + age for the UI). */
export interface LedgerStation {
  readonly commodityId: string;
  readonly marketId: number;
  readonly stationName: string;
  readonly systemName: string;
  readonly sellPrice: number;
  readonly source: string;
  readonly sourceTsMs: number;
  readonly padSize?: string;
  readonly demand?: number;
  readonly distanceLs?: number;
  /** Age of the observation (ms) — the "data age" badge. */
  readonly ageMs: number;
  readonly score: number;
}

export interface LedgerBoardEntry {
  readonly commodityId: string;
  readonly best: LedgerStation | null;
}

export interface LedgerTrendPoint {
  readonly tMs: number;
  readonly avgSellPrice: number;
  readonly maxSellPrice: number;
  readonly samples: number;
}

export interface LedgerStationQuery {
  readonly commodityId: string;
  readonly minPad?: "S" | "M" | "L";
  readonly maxDistanceLs?: number;
  readonly minDemand?: number;
}

export interface LedgerTrendQuery {
  readonly commodityId: string;
  readonly bucketMs: number;
}

export interface LedgerAlertRule {
  readonly id: number;
  readonly kind: AlertKind;
  readonly label: string | null;
  readonly commodityId: string | null;
  readonly threshold: number;
  readonly direction: AlertDirection;
  readonly cooldownMs: number;
  readonly enabled: boolean;
  readonly lastFiredTs: string | null;
  readonly createdAt: string;
}

export interface AlertRuleRequest {
  readonly kind: AlertKind;
  readonly label?: string;
  readonly commodityId?: string;
  readonly threshold: number;
  readonly direction?: AlertDirection;
  readonly cooldownMs?: number;
  readonly enabled?: boolean;
}

export interface AlertToggleRequest {
  readonly id: number;
  readonly enabled: boolean;
}

export interface AlertIdRequest {
  readonly id: number;
}
