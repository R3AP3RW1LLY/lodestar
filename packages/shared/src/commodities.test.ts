import { describe, expect, it } from "vitest";
import {
  COMMODITIES,
  commodityById,
  commodityFromEddn,
  commodityFromInternal,
} from "./commodities.js";
import type { MiningMethod } from "./commodities.js";

/** One fixture per naming scheme for a commodity — all must resolve to `id`. */
interface SchemeFixtures {
  readonly id: string;
  readonly prospect: string; // ProspectedAsteroid.Materials[].Name
  readonly refined: string; // MiningRefined.Type
  readonly marketSell: string; // MarketSell.Type
  readonly marketSymbol: string; // Market.json item symbol
  readonly eddn: string; // EDDN message name
}

const CASES: readonly SchemeFixtures[] = [
  {
    id: "opal",
    prospect: "Opal",
    refined: "$opal_name;",
    marketSell: "opal",
    marketSymbol: "$opal_name;",
    eddn: "Void Opals",
  },
  {
    id: "lowtemperaturediamond",
    prospect: "LowTemperatureDiamond",
    refined: "$lowtemperaturediamond_name;",
    marketSell: "lowtemperaturediamond",
    marketSymbol: "$lowtemperaturediamond_name;",
    eddn: "Low Temperature Diamonds",
  },
  {
    id: "platinum",
    prospect: "Platinum",
    refined: "$platinum_name;",
    marketSell: "platinum",
    marketSymbol: "$platinum_name;",
    eddn: "Platinum",
  },
  {
    id: "painite",
    prospect: "Painite",
    refined: "$painite_name;",
    marketSell: "painite",
    marketSymbol: "$painite_name;",
    eddn: "Painite",
  },
  {
    id: "rhodplumsite",
    prospect: "Rhodplumsite",
    refined: "$rhodplumsite_name;",
    marketSell: "rhodplumsite",
    marketSymbol: "$rhodplumsite_name;",
    eddn: "Rhodplumsite",
  },
  {
    id: "tritium",
    prospect: "Tritium",
    refined: "$tritium_name;",
    marketSell: "tritium",
    marketSymbol: "$tritium_name;",
    eddn: "Tritium",
  },
  {
    id: "osmium",
    prospect: "Osmium",
    refined: "$osmium_name;",
    marketSell: "osmium",
    marketSymbol: "$osmium_name;",
    eddn: "Osmium",
  },
  {
    id: "bromellite",
    prospect: "Bromellite",
    refined: "$bromellite_name;",
    marketSell: "bromellite",
    marketSymbol: "$bromellite_name;",
    eddn: "Bromellite",
  },
  {
    id: "alexandrite",
    prospect: "Alexandrite",
    refined: "$alexandrite_name;",
    marketSell: "alexandrite",
    marketSymbol: "$alexandrite_name;",
    eddn: "Alexandrite",
  },
];

describe("canonical commodity dictionary", () => {
  it.each(CASES)("every naming scheme for $id resolves to the same canonical id", (f) => {
    const ids = [
      commodityFromInternal(f.prospect),
      commodityFromInternal(f.refined),
      commodityFromInternal(f.marketSell),
      commodityFromInternal(f.marketSymbol),
      commodityFromEddn(f.eddn),
    ].map((r) => {
      expect(r.ok).toBe(true);
      return r.ok ? r.commodity.id : "";
    });
    expect(new Set(ids)).toEqual(new Set([f.id]));
  });

  it("resolution is case-insensitive and whitespace-tolerant across schemes", () => {
    for (const raw of ["PAINITE", "$PAINITE_name;", "Painite", "  painite  ", "\t$painite_name;"]) {
      const r = commodityFromInternal(raw);
      expect(r.ok && r.commodity.id).toBe("painite");
    }
    const eddn = commodityFromEddn("void opals");
    expect(eddn.ok && eddn.commodity.id).toBe("opal");
  });

  it("returns a typed unknown-commodity result (never a silent miss)", () => {
    const a = commodityFromInternal("adamantium");
    expect(a).toEqual({ ok: false, reason: "unknown-commodity", input: "adamantium" });
    const b = commodityFromEddn("Unobtanium");
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("unknown-commodity");
    expect(commodityById("adamantium")).toBeUndefined();
  });

  it("carries the EXACT mining methods for each commodity (matches the Step-2.3 matrix)", () => {
    // Exact set equality — catches a MISSING method (e.g. subsurface Platinum/Painite)
    // as well as an extra one, unlike arrayContaining.
    const expected: Record<string, readonly MiningMethod[]> = {
      platinum: ["laser", "subsurface"],
      painite: ["laser", "deep-core", "subsurface"],
      osmium: ["laser"],
      palladium: ["laser"],
      gold: ["laser"],
      lowtemperaturediamond: ["laser", "deep-core", "subsurface"],
      bromellite: ["laser", "deep-core", "subsurface"],
      tritium: ["laser", "subsurface"],
      opal: ["deep-core"],
      alexandrite: ["deep-core"],
      benitoite: ["deep-core"],
      musgravite: ["deep-core"],
      serendibite: ["deep-core"],
      grandidierite: ["deep-core"],
      monazite: ["deep-core"],
      rhodplumsite: ["deep-core"],
    };
    for (const [id, methods] of Object.entries(expected)) {
      expect(new Set(commodityById(id)?.methods)).toEqual(new Set(methods));
    }
  });

  it("has unique ids, symbols, and eddn names (no dictionary collisions)", () => {
    const ids = COMMODITIES.map((x) => x.id);
    const symbols = COMMODITIES.map((x) => x.symbol);
    const eddn = COMMODITIES.map((x) => x.eddnName.toLowerCase());
    expect(new Set(ids).size).toBe(COMMODITIES.length);
    expect(new Set(symbols).size).toBe(COMMODITIES.length);
    expect(new Set(eddn).size).toBe(COMMODITIES.length);
    // Every symbol resolves back to its own id (self-consistency).
    for (const x of COMMODITIES) {
      const r = commodityFromInternal(x.symbol);
      expect(r.ok && r.commodity.id).toBe(x.id);
    }
  });
});
