/**
 * Journal allowlist scrubber (SSOT Step 1.1). The repo is treated as PUBLIC from
 * commit #1, so any journal capture committed as a test fixture must first pass
 * through here: only the fields LODESTAR actually consumes (§5.1) survive, the
 * consumed-but-identifying fields (commander/FID/ship + carrier identity) are
 * replaced by constants, the timestamp is normalized, and everything else —
 * balances, squadron, friends/chat, unknown fields — is dropped.
 *
 * `findPiiLeaks` is the invariant the fixture corpus is gated on: every committed
 * line must return []. It walks the WHOLE JSON tree so nested identity/financial
 * data cannot hide, using curated key sets that are UNAMBIGUOUS at any depth
 * (never "Name"/"Crew", which are commodity/tonnage fields in most contexts) plus
 * event-scoped checks for the ambiguous ones (a Fleet Carrier's `Name` is
 * identity; a commodity's `Name` is not).
 *
 * Synthetic-first is the rule; this exists for the rare real capture whose odd
 * real-world formatting is worth reproducing.
 */

/** Fields present on (nearly) every event and always safe to keep. */
export const COMMON_FIELDS = ["event", "timestamp"] as const;

/** Committed fixtures use only this synthetic date; a real play-date is a leak (§5.1: fine timestamps). */
export const SYNTHETIC_DATE_PREFIX = "2025-06-01";

/** A scrubbed capture's timestamp is collapsed to this constant. */
export const NORMALIZED_TIMESTAMP = "2025-06-01T12:00:00Z";

/**
 * Unambiguous identity fields — these names are NEVER a commodity/module/ring/
 * tonnage field, so they are safe to detect and replace at any depth. Kept for
 * shape (LODESTAR uses them for session/relog/carrier bootstrap) but their VALUES
 * are replaced with these constants.
 */
export const SANITIZED_PII: Readonly<Record<string, string | number>> = {
  Commander: "CMDR_LODESTAR_FIXTURE",
  FID: "F0000000",
  ShipName: "LODESTAR TEST",
  ShipIdent: "LS-01",
  Callsign: "L0D-357",
  CarrierID: 3700000000,
};

/**
 * Ambiguous field names that are identity ONLY inside a specific event. `Name` is
 * a commodity/ring/module label almost everywhere, but a Fleet Carrier's chosen
 * name in `CarrierStats` — so it is sanitized per-event, never by blanket key.
 */
export const EVENT_SANITIZED_PII: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  CarrierStats: { Name: "LODESTAR FIXTURE CARRIER" },
};

/**
 * Field keys that must NEVER appear at any depth in a committed fixture. Curated
 * to keys that are UNAMBIGUOUSLY personal/financial in journals (so recursion
 * cannot false-positive on innocent reuse like `SpaceUsage.Crew`, a tonnage).
 */
export const FORBIDDEN_PII_FIELDS = [
  "Credits",
  "Loan",
  "Balance",
  "BankAccount",
  "CarrierBalance",
  "ReserveBalance",
  "AvailableBalance",
  "Squadron",
  "SquadronName",
  "Friends",
  "Killers",
  "Interdictor",
  "Powerplay",
  "PowerplayMerits",
  "Message",
  "Message_Localised",
  "From",
  "From_Localised",
  "Sent",
  "NpcCrew",
  "CrewName",
] as const;

/**
 * Per-event allowlist of consumed fields (§5.1). An event not listed here keeps
 * only COMMON_FIELDS. Fields in SANITIZED_PII / EVENT_SANITIZED_PII that appear
 * here are kept (shape) but value-replaced by scrubEvent.
 */
export const EVENT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  ProspectedAsteroid: ["Materials", "Content", "MotherlodeMaterial", "Remaining"],
  AsteroidCracked: ["Body"],
  MiningRefined: ["Type", "Type_Localised"],
  LaunchDrone: ["Type"],
  SAASignalsFound: ["BodyName", "SystemAddress", "BodyID", "Signals", "Genuses"],
  Scan: ["BodyName", "BodyID", "SystemAddress", "ReserveLevel", "Rings"],
  Cargo: ["Vessel", "Count", "Inventory"],
  MarketSell: ["MarketID", "Type", "Count", "SellPrice", "TotalSale", "AvgPricePaid"],
  MarketBuy: ["MarketID", "Type", "Count", "BuyPrice", "TotalCost"],
  Docked: [
    "StationName",
    "StationType",
    "StarSystem",
    "SystemAddress",
    "MarketID",
    "DistFromStarLS",
    "LandingPads",
  ],
  Undocked: ["StationName", "MarketID"],
  FSDJump: ["StarSystem", "SystemAddress", "StarPos", "JumpDist", "FuelUsed", "FuelLevel"],
  SupercruiseEntry: ["StarSystem", "Body", "BodyType"],
  SupercruiseExit: ["StarSystem", "Body", "BodyType"],
  Location: ["StarSystem", "SystemAddress", "StarPos", "Docked", "Body", "BodyType"],
  LoadGame: ["Commander", "FID", "Ship", "ShipName", "GameMode"],
  Loadout: ["Ship", "ShipName", "ShipIdent", "Modules", "CargoCapacity", "MaxJumpRange"],
  Music: ["MusicTrack"],
  // Carrier events (§5.1) — parsed in Phase 8. SpaceUsage/Finance are deferred to
  // Phase 8 (their nested financials need per-field sanitization); the corpus
  // needs only the identity + navigation shape now.
  CarrierStats: ["CarrierID", "Callsign", "Name", "FuelLevel", "JumpRangeCurr", "JumpRangeMax"],
  CarrierJumpRequest: ["CarrierID", "SystemName", "Body", "DepartureTime"],
  CarrierJump: ["CarrierID", "SystemName", "Body", "DepartureTime"],
  CarrierJumpCancelled: ["CarrierID"],
  CarrierTradeOrder: ["CarrierID", "Commodity", "PurchaseOrder", "SaleOrder", "Price"],
  CarrierDepositFuel: ["CarrierID", "Amount", "Total"],
  CargoTransfer: ["Transfers"],
};

type JournalEvent = Record<string, unknown>;

/** Scrub a single parsed event: allowlist its fields, sanitize identifiers, normalize the timestamp. */
export function scrubEvent(raw: JournalEvent): JournalEvent {
  const eventName = typeof raw["event"] === "string" ? raw["event"] : "";
  const result: JournalEvent = { timestamp: NORMALIZED_TIMESTAMP, event: eventName };
  const allowed = EVENT_ALLOWLIST[eventName] ?? [];
  const scoped = EVENT_SANITIZED_PII[eventName] ?? {};
  for (const field of allowed) {
    if (!(field in raw)) continue;
    result[field] = scoped[field] ?? SANITIZED_PII[field] ?? raw[field];
  }
  return result;
}

/** Scrub whole JSONL content: one event per line, blanks skipped, unparseable lines dropped. */
export function scrubJournalContent(content: string): string {
  const out: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      // Unparseable → cannot guarantee PII removal, so it does not survive.
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
    out.push(JSON.stringify(scrubEvent(parsed as JournalEvent)));
  }
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

const FORBIDDEN = new Set<string>(FORBIDDEN_PII_FIELDS);

/** Recursively collect leaking keys from any depth using the unambiguous key sets. */
function walkLeaks(node: unknown, leaks: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) walkLeaks(item, leaks);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [key, value] of Object.entries(node)) {
    if (FORBIDDEN.has(key)) leaks.add(key);
    const constant = SANITIZED_PII[key];
    if (constant !== undefined && value !== constant) leaks.add(key);
    walkLeaks(value, leaks);
  }
}

/** Returns the PII field classes leaking anywhere in `event` — [] means safe to commit. */
export function findPiiLeaks(event: JournalEvent): string[] {
  const leaks = new Set<string>();
  walkLeaks(event, leaks);
  // Event-scoped ambiguous identity (a Fleet Carrier's Name; commodity Name is fine).
  if (event["event"] === "CarrierStats" && "Name" in event) {
    const expected = EVENT_SANITIZED_PII["CarrierStats"]?.["Name"];
    if (event["Name"] !== expected) leaks.add("Name");
  }
  // Fine timestamps correlate to real play sessions.
  const ts = event["timestamp"];
  if (typeof ts === "string" && !ts.startsWith(SYNTHETIC_DATE_PREFIX)) leaks.add("timestamp");
  return [...leaks];
}
