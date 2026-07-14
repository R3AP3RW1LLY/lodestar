/**
 * Recorded-shape Inara inapi/v1 response fixtures (SSOT Step 4.9 — external-service test
 * doubles, policy-allowed). Hand-authored to match the inapi/v1 envelope; the market
 * `eventData` shape is provisional. Consumed only by the Inara tests.
 */

/** A successful market-reference response for a single `getCommodityPrices` event. */
export const INARA_PRICES_OK: unknown = {
  header: { eventStatus: 200, eventStatusText: "OK" },
  events: [
    {
      eventStatus: 200,
      eventData: [
        {
          commodityName: "Painite",
          stationName: "Nemere Terminal",
          systemName: "Paesia",
          marketId: 128016640,
          sellPrice: 512340,
          demand: 1200,
          priceUpdatedAt: "2025-06-01T12:00:00Z",
        },
        {
          commodityName: "Void Opals",
          stationName: "Some Port",
          systemName: "Borann",
          sellPrice: 1_100_000,
          demand: 340,
        },
        { commodityName: "Tea", stationName: "X", systemName: "Y", sellPrice: 1600, demand: 5 }, // non-mining → dropped
      ],
    },
  ],
};

/** An auth failure (invalid API key): header status 400. */
export const INARA_BAD_KEY: unknown = {
  header: { eventStatus: 400, eventStatusText: "Invalid API key" },
  events: [],
};
