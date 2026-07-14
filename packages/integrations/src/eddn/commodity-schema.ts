/**
 * EDDN `commodity/3` schema validation + plausibility (SSOT Step 4.8, pure). EDDN is an
 * unauthenticated open firehose — spoofable by design — so every message is validated
 * (correct `$schemaRef` + shape) and every price is bounds-checked before it can touch
 * `market_snapshots`. Only canonical mining commodities (Step 2.2) survive; EDDN prices
 * are advisory (the Ledger weights first-party sources above EDDN, Step 4.11).
 *
 * The per-commodity price bands are PROVISIONAL community-documented ceilings; the
 * Ledger's historical band + Phase-6 calibration refine them.
 */

import type { CommodityId, DomainError, Result } from "@lodestar/shared";
import { commodityFromInternal, domainError, err, ok } from "@lodestar/shared";

export const EDDN_COMMODITY_SCHEMA = "https://eddn.edcd.io/schemas/commodity/3";

export interface EddnCommodityPrice {
  readonly commodityId: CommodityId;
  readonly sellPrice: number;
  readonly demand: number;
}

export interface EddnMarketMessage {
  readonly systemName: string;
  readonly stationName: string;
  readonly marketId: number;
  readonly timestamp: string;
  readonly commodities: readonly EddnCommodityPrice[];
}

export interface PlausibilityBands {
  /** Per-commodity max plausible sell price (cr/ton). */
  readonly maxSellPrice: Readonly<Record<string, number>>;
  /** Fallback ceiling for a commodity without a specific band. */
  readonly genericMaxSellPrice: number;
  readonly maxDemand: number;
  readonly note: string;
}

export const DEFAULT_PLAUSIBILITY: PlausibilityBands = {
  maxSellPrice: {
    painite: 1_000_000,
    platinum: 500_000,
    osmium: 250_000,
    palladium: 120_000,
    gold: 100_000,
    silver: 90_000,
    lowtemperaturediamond: 1_500_000,
    opal: 1_800_000,
    alexandrite: 600_000,
    benitoite: 800_000,
    musgravite: 800_000,
    serendibite: 600_000,
    grandidierite: 600_000,
    monazite: 900_000,
    rhodplumsite: 900_000,
    bromellite: 200_000,
    tritium: 100_000,
  },
  genericMaxSellPrice: 2_000_000,
  maxDemand: 5_000_000,
  note: "provisional community-documented ceilings; Ledger historical band + Phase-6 calibration refine",
};

/** A single commodity price passes plausibility: finite, positive, within band; sane demand. */
export function isPlausiblePrice(
  commodityId: string,
  sellPrice: number,
  demand: number,
  bands: PlausibilityBands = DEFAULT_PLAUSIBILITY,
): boolean {
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) return false;
  if (!Number.isFinite(demand) || demand < 0 || demand > bands.maxDemand) return false;
  const ceiling = bands.maxSellPrice[commodityId] ?? bands.genericMaxSellPrice;
  return sellPrice <= ceiling;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface EddnParseResult {
  readonly market: EddnMarketMessage;
  /** Count of commodity rows dropped as unknown or implausible (telemetry). */
  readonly dropped: number;
}

/**
 * Validate an EDDN `commodity/3` envelope + message and keep only canonical mining
 * commodities that pass plausibility. A bad envelope/shape → typed error (drop the whole
 * frame); individual implausible/unknown commodities are dropped and counted.
 */
export function parseEddnCommodityMessage(
  raw: unknown,
  bands: PlausibilityBands = DEFAULT_PLAUSIBILITY,
): Result<EddnParseResult, DomainError> {
  if (!isRecord(raw) || raw.$schemaRef !== EDDN_COMMODITY_SCHEMA) {
    return err(domainError("eddn/wrong-schema", "not an EDDN commodity/3 message"));
  }
  const message = raw.message;
  if (
    !isRecord(message) ||
    typeof message.systemName !== "string" ||
    typeof message.stationName !== "string" ||
    typeof message.marketId !== "number" ||
    typeof message.timestamp !== "string" ||
    !Array.isArray(message.commodities)
  ) {
    return err(domainError("eddn/bad-message", "EDDN message body is malformed"));
  }
  const commodities: EddnCommodityPrice[] = [];
  let dropped = 0;
  for (const entry of message.commodities) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      typeof entry.sellPrice !== "number" ||
      typeof entry.demand !== "number"
    ) {
      dropped += 1;
      continue;
    }
    const lookup = commodityFromInternal(entry.name);
    if (
      !lookup.ok ||
      !isPlausiblePrice(lookup.commodity.id, entry.sellPrice, entry.demand, bands)
    ) {
      dropped += 1; // unknown-to-us commodity or an implausible/spoofed price
      continue;
    }
    commodities.push({
      commodityId: lookup.commodity.id,
      sellPrice: entry.sellPrice,
      demand: entry.demand,
    });
  }
  return ok({
    market: {
      systemName: message.systemName,
      stationName: message.stationName,
      marketId: message.marketId,
      timestamp: message.timestamp,
      commodities,
    },
    dropped,
  });
}
