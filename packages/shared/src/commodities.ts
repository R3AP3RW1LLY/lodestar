/**
 * Canonical commodity dictionary (SSOT Step 2.2). THE single commodity-identity
 * module every feature joins through, because the sources genuinely disagree on
 * names:
 *   - `ProspectedAsteroid.Materials[].Name` → internal name, PascalCase
 *     ("Painite", "Opal" for Void Opals, "LowTemperatureDiamond" for LTDs)
 *   - `MiningRefined.Type` / `Market.json` item symbol → "$..._name;"
 *   - `MarketSell.Type` → lowercase internal ("painite", "opal")
 *   - EDDN / Inara → their own display-style names ("Void Opals", "Low
 *     Temperature Diamonds")
 * The **canonical id is the internal name lowercased** — stable across game
 * versions and unambiguous. Every source scheme resolves to it; an unrecognized
 * name returns a typed `unknown-commodity` result (never a silent miss).
 * Pure data + pure functions — lives in `shared`.
 */

export type MiningMethod = "laser" | "deep-core" | "subsurface";

export interface Commodity {
  /** Canonical id = journal internal name, lowercased. */
  readonly id: string;
  /** `ProspectedAsteroid.Materials[].Name` (PascalCase internal name). */
  readonly internalName: string;
  /** `MiningRefined.Type` / `Market.json` symbol, e.g. "$painite_name;". */
  readonly symbol: string;
  /** Localised display name shown in the UI. */
  readonly displayName: string;
  /** EDDN canonical name. */
  readonly eddnName: string;
  /** Inara name. */
  readonly inaraName: string;
  /** Methods this commodity is mineable by (verified/community-documented in 2.3). */
  readonly methods: readonly MiningMethod[];
}

export type CommodityLookup =
  | { readonly ok: true; readonly commodity: Commodity }
  | { readonly ok: false; readonly reason: "unknown-commodity"; readonly input: string };

/** Build a commodity record; id + symbol are derived from the internal name. */
function c(
  internalName: string,
  displayName: string,
  methods: readonly MiningMethod[],
  over: { readonly eddnName?: string; readonly inaraName?: string } = {},
): Commodity {
  const id = internalName.toLowerCase();
  return {
    id,
    internalName,
    symbol: `$${id}_name;`,
    displayName,
    eddnName: over.eddnName ?? displayName,
    inaraName: over.inaraName ?? displayName,
    methods,
  };
}

/**
 * The mineable-commodity table. Names verified against current journal
 * observations / community references; methods match the Step-2.3 matrix.
 */
export const COMMODITIES: readonly Commodity[] = [
  // `methods` is the source of truth (matches the Step-2.3 matrix); the comments
  // only group loosely. Metals & core minerals:
  c("Platinum", "Platinum", ["laser", "subsurface"]),
  c("Painite", "Painite", ["laser", "deep-core", "subsurface"]),
  c("Osmium", "Osmium", ["laser"]),
  c("Palladium", "Palladium", ["laser"]),
  c("Gold", "Gold", ["laser"]),
  c("Silver", "Silver", ["laser"]),
  c("Bertrandite", "Bertrandite", ["laser"]),
  c("Indite", "Indite", ["laser"]),
  c("Gallite", "Gallite", ["laser"]),
  // Icy (per-entry methods; Tritium is laser+subsurface, NOT deep-core):
  c("Bromellite", "Bromellite", ["laser", "deep-core", "subsurface"]),
  c("LowTemperatureDiamond", "Low Temperature Diamonds", ["laser", "deep-core", "subsurface"]),
  c("Tritium", "Tritium", ["laser", "subsurface"]),
  // Deep-core gemstones:
  c("Opal", "Void Opals", ["deep-core"]),
  c("Alexandrite", "Alexandrite", ["deep-core"]),
  c("Benitoite", "Benitoite", ["deep-core"]),
  c("Musgravite", "Musgravite", ["deep-core"]),
  c("Serendibite", "Serendibite", ["deep-core"]),
  c("Grandidierite", "Grandidierite", ["deep-core"]),
  c("Monazite", "Monazite", ["deep-core"]),
  c("Rhodplumsite", "Rhodplumsite", ["deep-core"]),
];

const byIdIndex = new Map(COMMODITIES.map((x) => [x.id, x]));
const byEddnIndex = new Map(COMMODITIES.map((x) => [x.eddnName.toLowerCase(), x]));

/** Strip a "$..._name;" wrapper and trim+lowercase — the internal-scheme key. */
function internalKey(raw: string): string {
  return raw
    .trim()
    .replace(/^\$/, "")
    .replace(/_name;$/i, "")
    .toLowerCase();
}

function toLookup(commodity: Commodity | undefined, input: string): CommodityLookup {
  return commodity === undefined
    ? { ok: false, reason: "unknown-commodity", input }
    : { ok: true, commodity };
}

/**
 * Resolve any INTERNAL-scheme name to a commodity: `ProspectedAsteroid.Name`,
 * `MiningRefined.Type` / `Market.json` symbol, or `MarketSell.Type` — they all
 * reduce to the internal key (strip "$..._name;", lowercase).
 */
export function commodityFromInternal(raw: string): CommodityLookup {
  return toLookup(byIdIndex.get(internalKey(raw)), raw);
}

/** Resolve an EDDN canonical name (e.g. "Void Opals") to a commodity. */
export function commodityFromEddn(name: string): CommodityLookup {
  return toLookup(byEddnIndex.get(name.trim().toLowerCase()), name);
}

/** Look up a commodity by its canonical id. */
export function commodityById(id: string): Commodity | undefined {
  return byIdIndex.get(id);
}
