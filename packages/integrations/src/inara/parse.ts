/**
 * Inara inapi/v1 response parsing (SSOT Step 4.9, pure). The envelope is well-documented
 * (a `header` with an `eventStatus` + an `events` array, each event carrying its own
 * status + `eventData`); the market-reference `eventData` field shapes are PROVISIONAL
 * (verified against live Inara before shipping the real query). A non-2xx header status
 * (e.g. 400 for an invalid key) → typed error; malformed price rows are dropped.
 */

import type { CommodityId, DomainError, Result } from "@lodestar/shared";
import { commodityFromEddn, commodityFromInternal, domainError, err, ok } from "@lodestar/shared";

export interface InaraEventResult {
  readonly status: number;
  readonly data: unknown;
}

export interface InaraEnvelope {
  readonly headerStatus: number;
  readonly events: readonly InaraEventResult[];
}

export interface InaraCommodityPrice {
  readonly commodityId: CommodityId;
  readonly sellPrice: number;
  readonly demand: number;
  readonly stationName: string;
  readonly systemName: string;
  readonly marketId?: number;
  readonly updatedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validate the inapi/v1 envelope; a header status ≥ 400 (bad key / error) → typed error. */
export function parseInaraEnvelope(raw: unknown): Result<InaraEnvelope, DomainError> {
  if (!isRecord(raw) || !isRecord(raw.header) || !isFiniteNumber(raw.header.eventStatus)) {
    return err(domainError("inara/bad-envelope", "missing header.eventStatus"));
  }
  const headerStatus = raw.header.eventStatus;
  if (headerStatus >= 400) {
    const text = typeof raw.header.eventStatusText === "string" ? raw.header.eventStatusText : "";
    return err(
      domainError(
        "inara/api-error",
        `Inara rejected the request (${String(headerStatus)}) ${text}`,
      ),
    );
  }
  const events: InaraEventResult[] = [];
  if (Array.isArray(raw.events)) {
    for (const event of raw.events) {
      if (!isRecord(event)) continue;
      events.push({
        status: isFiniteNumber(event.eventStatus) ? event.eventStatus : 0,
        data: event.eventData,
      });
    }
  }
  return ok({ headerStatus, events });
}

/** Resolve an Inara commodity name (display or internal) to a canonical id. */
function resolveCommodity(name: string): CommodityId | undefined {
  const byEddn = commodityFromEddn(name);
  if (byEddn.ok) return byEddn.commodity.id;
  const byInternal = commodityFromInternal(name);
  return byInternal.ok ? byInternal.commodity.id : undefined;
}

/** Map an event's `eventData` price array to canonical commodity prices (malformed rows dropped). */
export function parseInaraCommodityPrices(data: unknown): InaraCommodityPrice[] {
  if (!Array.isArray(data)) return [];
  const prices: InaraCommodityPrice[] = [];
  for (const row of data) {
    if (
      !isRecord(row) ||
      typeof row.commodityName !== "string" ||
      !isFiniteNumber(row.sellPrice) ||
      !isFiniteNumber(row.demand) ||
      typeof row.stationName !== "string" ||
      typeof row.systemName !== "string"
    ) {
      continue;
    }
    const commodityId = resolveCommodity(row.commodityName);
    if (commodityId === undefined) continue;
    prices.push({
      commodityId,
      sellPrice: row.sellPrice,
      demand: row.demand,
      stationName: row.stationName,
      systemName: row.systemName,
      ...(isFiniteNumber(row.marketId) ? { marketId: row.marketId } : {}),
      ...(typeof row.priceUpdatedAt === "string" ? { updatedAt: row.priceUpdatedAt } : {}),
    });
  }
  return prices;
}
