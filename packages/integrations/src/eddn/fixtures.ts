/**
 * Recorded-shape EDDN `commodity/3` fixtures (SSOT Step 4.8 — external-service test
 * doubles, policy-allowed). Hand-authored to match EDDN's public schema; consumed only
 * by the EDDN tests, which zlib-compress them to exercise the real inflate path.
 */

import { EDDN_COMMODITY_SCHEMA } from "./commodity-schema.js";

/** A well-formed message: two mining commodities + one non-mining (dropped) + one implausible (dropped). */
export const EDDN_PAESIA_MARKET: unknown = {
  $schemaRef: EDDN_COMMODITY_SCHEMA,
  header: {
    uploaderID: "anon-hash",
    softwareName: "EDDiscovery",
    softwareVersion: "1.0",
    gatewayTimestamp: "2025-06-01T12:00:05Z",
  },
  message: {
    systemName: "Paesia",
    stationName: "Nemere Terminal",
    marketId: 128016640,
    timestamp: "2025-06-01T12:00:00Z",
    commodities: [
      { name: "painite", buyPrice: 0, sellPrice: 512340, demand: 1200, demandBracket: 3 },
      { name: "platinum", buyPrice: 0, sellPrice: 190500, demand: 4500, demandBracket: 3 },
      { name: "tea", buyPrice: 1400, sellPrice: 1600, demand: 20, demandBracket: 2 }, // non-mining → dropped
      { name: "painite", buyPrice: 0, sellPrice: 9_000_000, demand: 5, demandBracket: 1 }, // implausible → dropped
    ],
  },
};

/** A frame that decodes but is the wrong schema (must be dropped as a bad envelope). */
export const EDDN_WRONG_SCHEMA: unknown = {
  $schemaRef: "https://eddn.edcd.io/schemas/journal/1",
  message: { event: "FSDJump" },
};
