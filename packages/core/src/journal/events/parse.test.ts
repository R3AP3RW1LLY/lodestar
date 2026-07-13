import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { parseJournalEvent } from "./parse.js";
import type { Logger } from "@lodestar/shared";

const FIXTURE_DIR = fileURLToPath(new URL("../../../test/fixtures/journal/", import.meta.url));

const TS = "2025-06-01T12:00:00Z";
const base = (event: string, fields: Record<string, unknown>): Record<string, unknown> => ({
  timestamp: TS,
  event,
  ...fields,
});
const omit = (obj: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(obj).filter(([k]) => k !== key));

interface Case {
  readonly name: string;
  readonly valid: Record<string, unknown>;
  readonly requiredStrings: readonly string[];
  readonly requiredNumbers: readonly string[];
}

const CASES: readonly Case[] = [
  {
    name: "ProspectedAsteroid",
    valid: base("ProspectedAsteroid", {
      Materials: [{ Name: "painite", Proportion: 24.5 }],
      Content: "$AsteroidMaterialContent_High;",
      Remaining: 100,
      MotherlodeMaterial: "painite",
    }),
    requiredStrings: ["Content"],
    requiredNumbers: ["Remaining"],
  },
  {
    name: "AsteroidCracked",
    valid: base("AsteroidCracked", { Body: "Paesia 2 A Ring" }),
    requiredStrings: ["Body"],
    requiredNumbers: [],
  },
  {
    name: "MiningRefined",
    valid: base("MiningRefined", { Type: "$painite_name;", Type_Localised: "Painite" }),
    requiredStrings: ["Type"],
    requiredNumbers: [],
  },
  {
    name: "LaunchDrone",
    valid: base("LaunchDrone", { Type: "Prospector" }),
    requiredStrings: ["Type"],
    requiredNumbers: [],
  },
  {
    name: "SAASignalsFound",
    valid: base("SAASignalsFound", {
      BodyName: "Paesia 2 A Ring",
      SystemAddress: 4752151798219,
      BodyID: 15,
      Signals: [{ Type: "painite", Count: 2 }],
    }),
    requiredStrings: ["BodyName"],
    requiredNumbers: ["SystemAddress", "BodyID"],
  },
  {
    name: "Scan",
    valid: base("Scan", {
      BodyName: "Paesia 2",
      BodyID: 8,
      SystemAddress: 4752151798219,
      ReserveLevel: "PristineResources",
      Rings: [
        {
          Name: "Paesia 2 A Ring",
          RingClass: "eRingClass_Metalic",
          MassMT: 1.2e10,
          InnerRad: 1.3e8,
          OuterRad: 3.2e8,
        },
      ],
    }),
    requiredStrings: ["BodyName"],
    requiredNumbers: ["BodyID", "SystemAddress"],
  },
  {
    name: "Cargo",
    valid: base("Cargo", {
      Vessel: "Ship",
      Count: 12,
      Inventory: [{ Name: "painite", Count: 2, Stolen: 0 }],
    }),
    requiredStrings: ["Vessel"],
    requiredNumbers: ["Count"],
  },
  {
    name: "MarketSell",
    valid: base("MarketSell", {
      MarketID: 3229372160,
      Type: "painite",
      Count: 5,
      SellPrice: 500000,
      TotalSale: 2500000,
      AvgPricePaid: 0,
    }),
    requiredStrings: ["Type"],
    requiredNumbers: ["MarketID", "Count", "SellPrice", "TotalSale", "AvgPricePaid"],
  },
  {
    name: "MarketBuy",
    valid: base("MarketBuy", {
      MarketID: 3229372160,
      Type: "drones",
      Count: 20,
      BuyPrice: 101,
      TotalCost: 2020,
    }),
    requiredStrings: ["Type"],
    requiredNumbers: ["MarketID", "Count", "BuyPrice", "TotalCost"],
  },
  {
    name: "Docked",
    valid: base("Docked", {
      StationName: "Yurchikhin Terminal",
      StationType: "Coriolis",
      StarSystem: "LTT 15574",
      SystemAddress: 10477373803,
      MarketID: 3229372160,
      DistFromStarLS: 123.45,
      LandingPads: { Small: 9, Medium: 18, Large: 9 },
    }),
    requiredStrings: ["StationName", "StationType", "StarSystem"],
    requiredNumbers: ["SystemAddress", "MarketID"],
  },
  {
    name: "Undocked",
    valid: base("Undocked", { StationName: "Yurchikhin Terminal", MarketID: 3229372160 }),
    requiredStrings: ["StationName"],
    requiredNumbers: [],
  },
  {
    name: "FSDJump",
    valid: base("FSDJump", {
      StarSystem: "Paesia",
      SystemAddress: 4752151798219,
      StarPos: [-13.9, -6.1, -6.4],
      JumpDist: 18.34,
      FuelUsed: 2.11,
      FuelLevel: 29.89,
    }),
    requiredStrings: ["StarSystem"],
    requiredNumbers: ["SystemAddress", "JumpDist", "FuelUsed", "FuelLevel"],
  },
  {
    name: "SupercruiseEntry",
    valid: base("SupercruiseEntry", { StarSystem: "Paesia" }),
    requiredStrings: ["StarSystem"],
    requiredNumbers: [],
  },
  {
    name: "SupercruiseExit",
    valid: base("SupercruiseExit", {
      StarSystem: "Paesia",
      Body: "Paesia 2 A Ring",
      BodyType: "PlanetaryRing",
    }),
    requiredStrings: ["StarSystem"],
    requiredNumbers: [],
  },
  {
    name: "Location",
    valid: base("Location", {
      StarSystem: "Paesia",
      SystemAddress: 4752151798219,
      StarPos: [-13.9, -6.1, -6.4],
      Docked: false,
    }),
    requiredStrings: ["StarSystem"],
    requiredNumbers: ["SystemAddress"],
  },
  {
    name: "LoadGame",
    valid: base("LoadGame", {
      Commander: "CMDR_LODESTAR_FIXTURE",
      FID: "F0000000",
      Ship: "python",
      ShipName: "LODESTAR TEST",
      GameMode: "Solo",
    }),
    requiredStrings: ["Commander", "FID", "Ship", "ShipName"],
    requiredNumbers: [],
  },
  {
    name: "Loadout",
    valid: base("Loadout", {
      Ship: "python",
      ShipName: "LODESTAR TEST",
      ShipIdent: "LS-01",
      Modules: [{ Slot: "MediumHardpoint1", Item: "hpt_mining_abrblstr_fixed_medium" }],
      CargoCapacity: 256,
      MaxJumpRange: 22.55,
    }),
    requiredStrings: ["Ship", "ShipName"],
    requiredNumbers: ["CargoCapacity", "MaxJumpRange"],
  },
  {
    name: "Music",
    valid: base("Music", { MusicTrack: "Exploration" }),
    requiredStrings: ["MusicTrack"],
    requiredNumbers: [],
  },
];

describe("parseJournalEvent — per-event validation", () => {
  for (const c of CASES) {
    it(`${c.name}: happy path parses to the typed event`, () => {
      const r = parseJournalEvent(JSON.stringify(c.valid));
      expect(r.ok, JSON.stringify(r)).toBe(true);
      if (r.ok) expect(r.value.event).toBe(c.name);
    });

    for (const field of c.requiredStrings) {
      it(`${c.name}: missing ${field} → err`, () => {
        expect(parseJournalEvent(JSON.stringify(omit(c.valid, field))).ok).toBe(false);
      });
      it(`${c.name}: wrong-type ${field} (number) → err`, () => {
        const r = parseJournalEvent(JSON.stringify({ ...c.valid, [field]: 12345 }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.message).toContain(field);
      });
    }
    for (const field of c.requiredNumbers) {
      it(`${c.name}: missing ${field} → err`, () => {
        expect(parseJournalEvent(JSON.stringify(omit(c.valid, field))).ok).toBe(false);
      });
      it(`${c.name}: wrong-type ${field} (string) → err`, () => {
        expect(parseJournalEvent(JSON.stringify({ ...c.valid, [field]: "nope" })).ok).toBe(false);
      });
    }
  }
});

describe("parseJournalEvent — envelope + edge behavior", () => {
  it("tolerates unknown extra fields on a known event", () => {
    const r = parseJournalEvent(
      JSON.stringify(base("MiningRefined", { Type: "$painite_name;", Nonsense: { a: 1 }, X: [1] })),
    );
    expect(r.ok).toBe(true);
  });

  it("returns an UnknownJournalEvent for an unrecognized event (never dropped)", () => {
    const r = parseJournalEvent(JSON.stringify(base("Fileheader", { gameversion: "4.0" })));
    expect(r.ok).toBe(true);
    if (r.ok && r.value.event === "Unknown") {
      expect(r.value.rawEvent).toBe("Fileheader");
      expect(r.value.payload["gameversion"]).toBe("4.0");
    } else {
      expect.unreachable("expected Unknown event");
    }
  });

  it("errs (never throws) on malformed JSON", () => {
    const r = parseJournalEvent(`{"event":"MiningRefined","Type":`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("journal.parse.json");
  });

  it("errs on a non-object JSON line", () => {
    expect(parseJournalEvent(`[1,2,3]`).ok).toBe(false);
    expect(parseJournalEvent(`"a string"`).ok).toBe(false);
  });

  it("errs on a missing event or timestamp field", () => {
    expect(parseJournalEvent(JSON.stringify({ timestamp: TS })).ok).toBe(false);
    expect(parseJournalEvent(JSON.stringify({ event: "Music", MusicTrack: "x" })).ok).toBe(false);
  });

  it("errs on a malformed StarPos vector (not [number, number, number])", () => {
    const fsd = {
      StarSystem: "Sys",
      SystemAddress: 1,
      JumpDist: 10,
      FuelUsed: 1,
      FuelLevel: 20,
    };
    expect(parseJournalEvent(JSON.stringify(base("FSDJump", { ...fsd, StarPos: [1, 2] }))).ok).toBe(
      false,
    );
    expect(
      parseJournalEvent(JSON.stringify(base("FSDJump", { ...fsd, StarPos: [1, "x", 3] }))).ok,
    ).toBe(false);
  });

  it("errs on a wrong-typed optional number (Docked.DistFromStarLS as string)", () => {
    const valid = {
      StationName: "S",
      StationType: "Coriolis",
      StarSystem: "Sys",
      SystemAddress: 1,
      MarketID: 2,
    };
    const r = parseJournalEvent(
      JSON.stringify(base("Docked", { ...valid, DistFromStarLS: "far" })),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("DistFromStarLS");
  });

  it("parses Docked.LandingPads and rejects a malformed pad object", () => {
    const dockBase = {
      StationName: "S",
      StationType: "Coriolis",
      StarSystem: "Sys",
      SystemAddress: 1,
      MarketID: 2,
    };
    const ok1 = parseJournalEvent(
      JSON.stringify(
        base("Docked", { ...dockBase, LandingPads: { Small: 1, Medium: 2, Large: 3 } }),
      ),
    );
    expect(ok1.ok).toBe(true);
    if (ok1.ok && ok1.value.event === "Docked") {
      expect(ok1.value.landingPads).toEqual({ small: 1, medium: 2, large: 3 });
    }
    // LandingPads present but a pad count is the wrong type → err.
    expect(
      parseJournalEvent(
        JSON.stringify(
          base("Docked", { ...dockBase, LandingPads: { Small: "x", Medium: 2, Large: 3 } }),
        ),
      ).ok,
    ).toBe(false);
    // LandingPads absent → still ok (optional).
    expect(parseJournalEvent(JSON.stringify(base("Docked", dockBase))).ok).toBe(true);
    // LandingPads present but not an object → err (child expects an object).
    expect(
      parseJournalEvent(JSON.stringify(base("Docked", { ...dockBase, LandingPads: 5 }))).ok,
    ).toBe(false);
  });

  it("errs when an object-array element is not an object (Materials: [123])", () => {
    const r = parseJournalEvent(
      JSON.stringify(
        base("ProspectedAsteroid", { Materials: [123], Content: "x", Remaining: 100 }),
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("Materials[0]");
  });

  it("validates nested array element fields (Materials[].Proportion wrong type)", () => {
    const r = parseJournalEvent(
      JSON.stringify(
        base("ProspectedAsteroid", {
          Materials: [{ Name: "painite", Proportion: "high" }],
          Content: "$AsteroidMaterialContent_High;",
          Remaining: 100,
        }),
      ),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain("Materials[0].Proportion");
  });

  it("omits optional fields when absent (exactOptional-safe)", () => {
    const r = parseJournalEvent(JSON.stringify(base("MiningRefined", { Type: "$painite_name;" })));
    expect(r.ok).toBe(true);
    if (r.ok && r.value.event === "MiningRefined") {
      expect(r.value).not.toHaveProperty("typeLocalised");
    }
  });

  it("logs telemetry for unknown events and parse failures", () => {
    const logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
    } as unknown as Logger;
    parseJournalEvent(JSON.stringify(base("Fileheader", {})), logger);
    parseJournalEvent(JSON.stringify(base("MiningRefined", {})), logger); // missing Type
    parseJournalEvent(`not json`, logger);
    expect(logger.debug).toHaveBeenCalledWith("journal.unknown-event", { event: "Fileheader" });
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("parseJournalEvent over the real fixture corpus", () => {
  it("parses every line of the mining session to a known event or Unknown, never err/throw", () => {
    for (const file of ["Journal.2025-06-01T120000.01.log", "Journal.2025-06-01T120000.02.log"]) {
      const raw = readFileSync(join(FIXTURE_DIR, file), "utf8");
      for (const lineText of raw.split(/\r?\n/)) {
        const trimmed = lineText.trim();
        if (trimmed === "") continue;
        const r = parseJournalEvent(trimmed);
        expect(r.ok, `${file}: ${trimmed.slice(0, 60)}`).toBe(true);
      }
    }
  });

  it("falls the carrier fixture (Phase-8 events) through to Unknown, never erroring", () => {
    const raw = readFileSync(join(FIXTURE_DIR, "Journal.2025-06-01T140000.01.log"), "utf8");
    let sawCarrier = false;
    for (const lineText of raw.split(/\r?\n/)) {
      const trimmed = lineText.trim();
      if (trimmed === "") continue;
      const r = parseJournalEvent(trimmed);
      expect(r.ok, trimmed.slice(0, 60)).toBe(true);
      if (r.ok) {
        expect(r.value.event).toBe("Unknown");
        if (r.value.event === "Unknown" && r.value.rawEvent.startsWith("Carrier")) {
          sawCarrier = true;
        }
      }
    }
    expect(sawCarrier).toBe(true); // the fixture really does contain carrier events
  });
});
