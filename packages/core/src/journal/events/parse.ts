/**
 * Journal event parsers (SSOT §5.1 / Step 1.5). `parseJournalEvent` turns a raw
 * journal line into a typed `ParsedJournalEvent`:
 *   - malformed JSON or a non-object / missing `event`+`timestamp` → `Result.err`
 *     (with context) — it NEVER throws to the caller.
 *   - a known event → its validated domain type; extra fields are ignored.
 *   - a missing/wrong-type consumed field → `Result.err` naming the field.
 *   - an unrecognized event → `UnknownJournalEvent` (never dropped).
 * Unknown events and parse failures are logged as local telemetry (schema drift).
 *
 * Field validation uses a `Reader` that throws an internal `ParseError`, caught
 * and mapped to `Result.err` here — throwing is a private control-flow detail.
 */

import { domainError, err, nullLogger, ok } from "@lodestar/shared";
import type { DomainError, Logger, ParsedJournalEvent, Result, Vec3 } from "@lodestar/shared";

class ParseError extends Error {
  constructor(
    readonly field: string,
    readonly reason: string,
  ) {
    super(`${field}: ${reason}`);
    this.name = "ParseError";
  }
}

class Reader {
  constructor(
    private readonly obj: Readonly<Record<string, unknown>>,
    private readonly prefix = "",
  ) {}

  has(key: string): boolean {
    return this.obj[key] !== undefined;
  }

  string(key: string): string {
    const v = this.obj[key];
    if (typeof v !== "string") throw new ParseError(this.prefix + key, "expected string");
    return v;
  }

  number(key: string): number {
    const v = this.obj[key];
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new ParseError(this.prefix + key, "expected number");
    return v;
  }

  boolean(key: string): boolean {
    const v = this.obj[key];
    if (typeof v !== "boolean") throw new ParseError(this.prefix + key, "expected boolean");
    return v;
  }

  optionalString(key: string): string | undefined {
    const v = this.obj[key];
    if (v === undefined) return undefined;
    if (typeof v !== "string") throw new ParseError(this.prefix + key, "expected string or absent");
    return v;
  }

  optionalNumber(key: string): number | undefined {
    const v = this.obj[key];
    if (v === undefined) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new ParseError(this.prefix + key, "expected number or absent");
    return v;
  }

  vec3(key: string): Vec3 {
    const v = this.obj[key];
    if (
      !Array.isArray(v) ||
      v.length !== 3 ||
      v.some((n) => typeof n !== "number" || !Number.isFinite(n))
    ) {
      throw new ParseError(this.prefix + key, "expected [number, number, number]");
    }
    return [v[0] as number, v[1] as number, v[2] as number];
  }

  child(key: string): Reader {
    const v = this.obj[key];
    if (typeof v !== "object" || v === null || Array.isArray(v))
      throw new ParseError(this.prefix + key, "expected object");
    return new Reader(v as Record<string, unknown>, `${this.prefix}${key}.`);
  }

  objectArray<T>(key: string, map: (child: Reader) => T): T[] {
    const v = this.obj[key];
    if (!Array.isArray(v)) throw new ParseError(this.prefix + key, "expected array");
    return v.map((item, i) => {
      if (typeof item !== "object" || item === null || Array.isArray(item))
        throw new ParseError(`${this.prefix}${key}[${String(i)}]`, "expected object");
      return map(
        new Reader(item as Record<string, unknown>, `${this.prefix}${key}[${String(i)}].`),
      );
    });
  }
}

/** Include `[key]: value` only when value is defined (respects exactOptionalPropertyTypes). */
function opt<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<never, never> {
  return value === undefined ? {} : { [key]: value };
}

type EventParser = (r: Reader, timestamp: string) => ParsedJournalEvent;

const PARSERS: Readonly<Record<string, EventParser>> = {
  ProspectedAsteroid: (r, timestamp) => ({
    event: "ProspectedAsteroid",
    timestamp,
    materials: r.objectArray("Materials", (c) => ({
      name: c.string("Name"),
      proportion: c.number("Proportion"),
    })),
    content: r.string("Content"),
    remaining: r.number("Remaining"),
    ...opt("motherlodeMaterial", r.optionalString("MotherlodeMaterial")),
  }),
  AsteroidCracked: (r, timestamp) => ({
    event: "AsteroidCracked",
    timestamp,
    body: r.string("Body"),
  }),
  MiningRefined: (r, timestamp) => ({
    event: "MiningRefined",
    timestamp,
    type: r.string("Type"),
    ...opt("typeLocalised", r.optionalString("Type_Localised")),
  }),
  LaunchDrone: (r, timestamp) => ({
    event: "LaunchDrone",
    timestamp,
    droneType: r.string("Type"),
  }),
  SAASignalsFound: (r, timestamp) => ({
    event: "SAASignalsFound",
    timestamp,
    bodyName: r.string("BodyName"),
    systemAddress: r.number("SystemAddress"),
    bodyId: r.number("BodyID"),
    signals: r.objectArray("Signals", (c) => ({
      type: c.string("Type"),
      count: c.number("Count"),
    })),
  }),
  Scan: (r, timestamp) => ({
    event: "Scan",
    timestamp,
    bodyName: r.string("BodyName"),
    bodyId: r.number("BodyID"),
    systemAddress: r.number("SystemAddress"),
    ...opt("reserveLevel", r.optionalString("ReserveLevel")),
    ...opt(
      "rings",
      r.has("Rings")
        ? r.objectArray("Rings", (c) => ({
            name: c.string("Name"),
            ringClass: c.string("RingClass"),
            massMt: c.number("MassMT"),
            innerRad: c.number("InnerRad"),
            outerRad: c.number("OuterRad"),
          }))
        : undefined,
    ),
  }),
  Cargo: (r, timestamp) => ({
    event: "Cargo",
    timestamp,
    vessel: r.string("Vessel"),
    count: r.number("Count"),
    ...opt(
      "inventory",
      r.has("Inventory")
        ? r.objectArray("Inventory", (c) => ({
            name: c.string("Name"),
            count: c.number("Count"),
            stolen: c.number("Stolen"),
          }))
        : undefined,
    ),
  }),
  MarketSell: (r, timestamp) => ({
    event: "MarketSell",
    timestamp,
    marketId: r.number("MarketID"),
    type: r.string("Type"),
    count: r.number("Count"),
    sellPrice: r.number("SellPrice"),
    totalSale: r.number("TotalSale"),
    avgPricePaid: r.number("AvgPricePaid"),
  }),
  MarketBuy: (r, timestamp) => ({
    event: "MarketBuy",
    timestamp,
    marketId: r.number("MarketID"),
    type: r.string("Type"),
    count: r.number("Count"),
    buyPrice: r.number("BuyPrice"),
    totalCost: r.number("TotalCost"),
  }),
  Docked: (r, timestamp) => ({
    event: "Docked",
    timestamp,
    stationName: r.string("StationName"),
    stationType: r.string("StationType"),
    starSystem: r.string("StarSystem"),
    systemAddress: r.number("SystemAddress"),
    marketId: r.number("MarketID"),
    ...opt("distFromStarLs", r.optionalNumber("DistFromStarLS")),
    ...opt(
      "landingPads",
      r.has("LandingPads")
        ? ((c) => ({
            small: c.number("Small"),
            medium: c.number("Medium"),
            large: c.number("Large"),
          }))(r.child("LandingPads"))
        : undefined,
    ),
  }),
  Undocked: (r, timestamp) => ({
    event: "Undocked",
    timestamp,
    stationName: r.string("StationName"),
    ...opt("marketId", r.optionalNumber("MarketID")),
  }),
  FSDJump: (r, timestamp) => ({
    event: "FSDJump",
    timestamp,
    starSystem: r.string("StarSystem"),
    systemAddress: r.number("SystemAddress"),
    starPos: r.vec3("StarPos"),
    jumpDist: r.number("JumpDist"),
    fuelUsed: r.number("FuelUsed"),
    fuelLevel: r.number("FuelLevel"),
  }),
  SupercruiseEntry: (r, timestamp) => ({
    event: "SupercruiseEntry",
    timestamp,
    starSystem: r.string("StarSystem"),
    ...opt("body", r.optionalString("Body")),
    ...opt("bodyType", r.optionalString("BodyType")),
  }),
  SupercruiseExit: (r, timestamp) => ({
    event: "SupercruiseExit",
    timestamp,
    starSystem: r.string("StarSystem"),
    ...opt("body", r.optionalString("Body")),
    ...opt("bodyType", r.optionalString("BodyType")),
  }),
  Location: (r, timestamp) => ({
    event: "Location",
    timestamp,
    starSystem: r.string("StarSystem"),
    systemAddress: r.number("SystemAddress"),
    starPos: r.vec3("StarPos"),
    docked: r.boolean("Docked"),
    ...opt("body", r.optionalString("Body")),
    ...opt("bodyType", r.optionalString("BodyType")),
  }),
  LoadGame: (r, timestamp) => ({
    event: "LoadGame",
    timestamp,
    commander: r.string("Commander"),
    fid: r.string("FID"),
    ship: r.string("Ship"),
    shipName: r.string("ShipName"),
    ...opt("gameMode", r.optionalString("GameMode")),
  }),
  Loadout: (r, timestamp) => ({
    event: "Loadout",
    timestamp,
    ship: r.string("Ship"),
    shipName: r.string("ShipName"),
    ...opt("shipIdent", r.optionalString("ShipIdent")),
    modules: r.objectArray("Modules", (c) => ({
      slot: c.string("Slot"),
      item: c.string("Item"),
    })),
    cargoCapacity: r.number("CargoCapacity"),
    maxJumpRange: r.number("MaxJumpRange"),
  }),
  Music: (r, timestamp) => ({
    event: "Music",
    timestamp,
    musicTrack: r.string("MusicTrack"),
  }),
};

export function parseJournalEvent(
  raw: string,
  logger: Logger = nullLogger,
): Result<ParsedJournalEvent, DomainError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn("journal.parse.json", { raw: raw.slice(0, 80) });
    return err(domainError("journal.parse.json", "line is not valid JSON"));
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err(domainError("journal.parse.shape", "event is not a JSON object"));
  }
  const obj = parsed as Record<string, unknown>;
  const eventName = obj["event"];
  const timestamp = obj["timestamp"];
  if (typeof eventName !== "string") {
    return err(domainError("journal.parse.event", "missing string 'event' field"));
  }
  if (typeof timestamp !== "string") {
    return err(domainError("journal.parse.timestamp", `${eventName}: missing string 'timestamp'`));
  }
  const parser = PARSERS[eventName];
  if (parser === undefined) {
    logger.debug("journal.unknown-event", { event: eventName });
    return ok({ event: "Unknown", timestamp, rawEvent: eventName, payload: obj });
  }
  try {
    return ok(parser(new Reader(obj), timestamp));
  } catch (e) {
    if (e instanceof ParseError) {
      logger.warn("journal.parse.field", { event: eventName, field: e.field, reason: e.reason });
      return err(domainError("journal.parse.field", `${eventName}.${e.field}: ${e.reason}`));
    }
    // A parser should only ever throw ParseError; anything else is a bug, but the
    // contract is absolute — one bad line must never crash journal ingestion.
    logger.error("journal.parse.internal", { event: eventName, error: String(e) });
    return err(domainError("journal.parse.internal", `${eventName}: internal parse error`));
  }
}
