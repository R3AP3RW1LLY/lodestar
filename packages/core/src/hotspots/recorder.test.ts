import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import type { ParsedJournalEvent } from "@lodestar/shared";
import { createHotspotRecorder } from "./recorder.js";
import type { RecorderLocation } from "./recorder.js";

/** The commander is at Paesia (its address + coords are known from FSDJump/Location). */
const AT_PAESIA: RecorderLocation = {
  system: "Paesia",
  systemAddress: 100,
  starPos: [10, 20, 30],
};

const scanEvent = (
  rings: { name: string; ringClass: string }[] | undefined,
  reserveLevel: string | undefined,
  systemAddress = 100,
): ParsedJournalEvent => ({
  event: "Scan",
  timestamp: "2025-06-01T00:00:00Z",
  bodyName: "Paesia 2",
  bodyId: 5,
  systemAddress,
  ...(reserveLevel === undefined ? {} : { reserveLevel }),
  ...(rings === undefined
    ? {}
    : { rings: rings.map((r) => ({ ...r, massMt: 1, innerRad: 1, outerRad: 2 })) }),
});

const saaEvent = (
  bodyName: string,
  signals: { type: string; count: number }[],
  timestamp = "2025-06-02T00:00:00Z",
  systemAddress = 100,
): ParsedJournalEvent => ({
  event: "SAASignalsFound",
  timestamp,
  bodyName,
  systemAddress,
  bodyId: 5,
  signals,
});

describe("hotspot recorder", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
  });
  afterEach(() => db.close());

  const rows = <T>(sql: string): T[] => db.prepare(sql).all() as T[];

  it("records a body Scan as system + body + ring with normalized type + reserve", () => {
    const result = createHotspotRecorder(db).record(
      scanEvent(
        [{ name: "Paesia 2 A Ring", ringClass: "eRingClass_Metalic" }],
        "PristineResources",
      ),
      AT_PAESIA,
    );
    expect(result).toEqual({ status: "recorded", ringsTouched: 1, hotspotsRecorded: 0 });
    expect(rows("SELECT name, x, y, z FROM systems")).toEqual([
      { name: "Paesia", x: 10, y: 20, z: 30 },
    ]);
    expect(rows("SELECT name, ring_type, reserve FROM rings")).toEqual([
      { name: "Paesia 2 A Ring", ring_type: "Metallic", reserve: "Pristine" },
    ]);
  });

  it("records SAASignalsFound hotspots with source='journal', filtering non-minerals", () => {
    const result = createHotspotRecorder(db).record(
      saaEvent("Paesia 2 A Ring", [
        { type: "$SAA_SignalType_Painite;", count: 2 },
        { type: "$SAA_SignalType_Platinum;", count: 1 },
        { type: "$SAA_SignalType_Geological;", count: 9 }, // dropped
      ]),
      AT_PAESIA,
    );
    expect(result).toEqual({ status: "recorded", ringsTouched: 1, hotspotsRecorded: 2 });
    expect(
      rows<{ commodity_id: string; count: number; source: string }>(
        "SELECT commodity_id, count, source FROM hotspots ORDER BY commodity_id",
      ),
    ).toEqual([
      { commodity_id: "painite", count: 2, source: "journal" },
      { commodity_id: "platinum", count: 1, source: "journal" },
    ]);
  });

  it("re-scan refreshes count + last_confirmed but keeps first_seen (no duplicate)", () => {
    const recorder = createHotspotRecorder(db);
    recorder.record(
      saaEvent(
        "Paesia 2 A Ring",
        [{ type: "$SAA_SignalType_Painite;", count: 2 }],
        "2025-06-02T00:00:00Z",
      ),
      AT_PAESIA,
    );
    recorder.record(
      saaEvent(
        "Paesia 2 A Ring",
        [{ type: "$SAA_SignalType_Painite;", count: 3 }],
        "2025-08-01T00:00:00Z",
      ),
      AT_PAESIA,
    );
    const hotspot = rows<{ count: number; first_seen: string; last_confirmed: string }>(
      "SELECT count, first_seen, last_confirmed FROM hotspots",
    );
    expect(hotspot).toEqual([
      { count: 3, first_seen: "2025-06-02T00:00:00Z", last_confirmed: "2025-08-01T00:00:00Z" },
    ]);
  });

  it("links a Scan and a later SAASignalsFound onto the same ring (type+reserve + hotspots)", () => {
    const recorder = createHotspotRecorder(db);
    recorder.record(
      scanEvent(
        [{ name: "Paesia 2 A Ring", ringClass: "eRingClass_Metalic" }],
        "PristineResources",
      ),
      AT_PAESIA,
    );
    recorder.record(
      saaEvent("Paesia 2 A Ring", [{ type: "$SAA_SignalType_Painite;", count: 2 }]),
      AT_PAESIA,
    );
    // One ring row carrying BOTH the scoring inputs (type+reserve) and the hotspot.
    expect(rows("SELECT COUNT(*) AS n FROM rings")).toEqual([{ n: 1 }]);
    const joined = rows(
      `SELECT r.ring_type, r.reserve, h.commodity_id, h.count
         FROM hotspots h JOIN rings r ON r.id = h.ring_id`,
    );
    expect(joined).toEqual([
      { ring_type: "Metallic", reserve: "Pristine", commodity_id: "painite", count: 2 },
    ]);
  });

  describe("skips and ignores (writes nothing)", () => {
    const expectEmpty = (): void => {
      expect(rows("SELECT COUNT(*) AS n FROM systems")).toEqual([{ n: 0 }]);
      expect(rows("SELECT COUNT(*) AS n FROM hotspots")).toEqual([{ n: 0 }]);
    };

    it("skips when the current location is unknown", () => {
      const result = createHotspotRecorder(db).record(
        saaEvent("Paesia 2 A Ring", [{ type: "$SAA_SignalType_Painite;", count: 2 }]),
        { system: "Paesia" }, // no address/coords
      );
      expect(result).toEqual({ status: "skipped", reason: "no-location" });
      expectEmpty();
    });

    it("skips when the event is for a different system than the current location", () => {
      const result = createHotspotRecorder(db).record(
        saaEvent(
          "Paesia 2 A Ring",
          [{ type: "$SAA_SignalType_Painite;", count: 2 }],
          undefined,
          999,
        ),
        AT_PAESIA,
      );
      expect(result).toEqual({ status: "skipped", reason: "system-mismatch" });
      expectEmpty();
    });

    it("skips a Scan with no rings", () => {
      const result = createHotspotRecorder(db).record(scanEvent(undefined, undefined), AT_PAESIA);
      expect(result).toEqual({ status: "skipped", reason: "no-rings" });
      expectEmpty();
    });

    it("skips a planetary-surface SAASignalsFound (biological/geological only)", () => {
      const result = createHotspotRecorder(db).record(
        saaEvent("Nervi 2 A", [{ type: "$SAA_SignalType_Biological;", count: 3 }]),
        { system: "Nervi", systemAddress: 100, starPos: [1, 2, 3] },
      );
      expect(result).toEqual({ status: "skipped", reason: "no-minerals" });
      expectEmpty();
    });

    it("ignores an unrelated event", () => {
      const result = createHotspotRecorder(db).record(
        { event: "Music", timestamp: "2025-06-01T00:00:00Z", musicTrack: "MainMenu" },
        AT_PAESIA,
      );
      expect(result).toEqual({ status: "ignored" });
      expectEmpty();
    });
  });
});
