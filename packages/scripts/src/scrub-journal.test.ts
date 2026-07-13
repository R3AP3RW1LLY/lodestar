import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  FORBIDDEN_PII_FIELDS,
  SANITIZED_PII,
  findPiiLeaks,
  scrubEvent,
  scrubJournalContent,
} from "./scrub-journal.js";

// Cross-package by design: the scrubber (tooling) gates @lodestar/core's committed
// fixture corpus by filesystem path (not a module import — @lodestar/scripts may
// only depend on @lodestar/shared). Mirror of packages/core/src/journal/fixtures.test.ts.
const CORPUS_DIR = fileURLToPath(new URL("../../core/test/fixtures/journal/", import.meta.url));
const BOM = 0xfeff;

describe("scrubEvent", () => {
  it("keeps only allowlisted fields for a known event and drops the rest", () => {
    const scrubbed = scrubEvent({
      timestamp: "2025-06-01T12:00:00Z",
      event: "MarketSell",
      MarketID: 128000000,
      Type: "painite",
      Count: 10,
      SellPrice: 500000,
      TotalSale: 5000000,
      AvgPricePaid: 100,
      // Not consumed / noise that must not survive:
      Type_Localised: "Painite",
      IllegalGoods: false,
      StolenGoods: false,
    });
    expect(scrubbed).toEqual({
      timestamp: "2025-06-01T12:00:00Z",
      event: "MarketSell",
      MarketID: 128000000,
      Type: "painite",
      Count: 10,
      SellPrice: 500000,
      TotalSale: 5000000,
      AvgPricePaid: 100,
    });
  });

  it("replaces identifying fields (Commander/FID/ShipName/ShipIdent) with constants, never the real value", () => {
    const scrubbed = scrubEvent({
      timestamp: "2025-06-01T12:00:00Z",
      event: "LoadGame",
      Commander: "RealCmdrName",
      FID: "F1234567",
      Ship: "python",
      ShipName: "MY SECRET SHIP",
      ShipIdent: "XX-99",
      GameMode: "Solo",
      Credits: 999999999,
    });
    expect(scrubbed["Commander"]).toBe(SANITIZED_PII["Commander"]);
    expect(scrubbed["FID"]).toBe(SANITIZED_PII["FID"]);
    expect(scrubbed["ShipName"]).toBe(SANITIZED_PII["ShipName"]);
    expect(scrubbed["Ship"]).toBe("python"); // ship TYPE is not PII
    expect(scrubbed["GameMode"]).toBe("Solo");
    expect(scrubbed).not.toHaveProperty("Credits"); // balance never survives
  });

  it("normalizes the timestamp of a scrubbed capture to a constant", () => {
    const scrubbed = scrubEvent({
      timestamp: "2024-11-03T21:47:13Z",
      event: "MiningRefined",
      Type: "painite",
    });
    expect(scrubbed["timestamp"]).toBe("2025-06-01T12:00:00Z");
  });

  it("passes an unknown event through with only the common fields", () => {
    const scrubbed = scrubEvent({
      timestamp: "2025-06-01T12:00:00Z",
      event: "SomeFutureEvent",
      SecretField: "leak",
      AnotherField: 42,
    });
    expect(scrubbed).toEqual({ timestamp: "2025-06-01T12:00:00Z", event: "SomeFutureEvent" });
  });

  it("drops a whole never-consumed PII event down to common fields (friends/chat)", () => {
    const scrubbed = scrubEvent({
      timestamp: "2025-06-01T12:00:00Z",
      event: "ReceiveText",
      From: "SomeCmdr",
      Message: "gl hf o7",
      Channel: "wing",
    });
    expect(scrubbed).toEqual({ timestamp: "2025-06-01T12:00:00Z", event: "ReceiveText" });
    expect(findPiiLeaks(scrubbed)).toEqual([]);
  });

  it("preserves nested consumed arrays (ProspectedAsteroid materials)", () => {
    const scrubbed = scrubEvent({
      timestamp: "2025-06-01T12:00:00Z",
      event: "ProspectedAsteroid",
      Materials: [{ Name: "painite", Proportion: 24.5 }],
      Content: "$AsteroidMaterialContent_High;",
      Remaining: 100,
      MotherlodeMaterial: "painite",
    });
    expect(scrubbed["Materials"]).toEqual([{ Name: "painite", Proportion: 24.5 }]);
    expect(scrubbed["Content"]).toBe("$AsteroidMaterialContent_High;");
  });

  it("sanitizes Fleet Carrier identity and drops its financials", () => {
    const scrubbed = scrubEvent({
      timestamp: "2024-01-01T00:00:00Z",
      event: "CarrierStats",
      CarrierID: 3799999999,
      Callsign: "ABC-123",
      Name: "Real Carrier Name",
      FuelLevel: 100,
      Finance: { CarrierBalance: 999999999 },
    });
    expect(scrubbed["CarrierID"]).toBe(SANITIZED_PII["CarrierID"]);
    expect(scrubbed["Callsign"]).toBe(SANITIZED_PII["Callsign"]);
    expect(scrubbed["Name"]).toBe("LODESTAR FIXTURE CARRIER");
    expect(scrubbed["FuelLevel"]).toBe(100);
    expect(scrubbed).not.toHaveProperty("Finance"); // financials never survive
    expect(findPiiLeaks(scrubbed)).toEqual([]);
  });
});

describe("scrubJournalContent", () => {
  it("scrubs each line, skips blanks, and drops unparseable lines (cannot guarantee PII removal)", () => {
    const raw = [
      `{"timestamp":"2024-01-01T00:00:00Z","event":"LoadGame","Commander":"Real","FID":"F9","Ship":"python","ShipName":"secret","GameMode":"Open"}`,
      ``,
      `{"timestamp":"2024-01-01T00:0` /* truncated / unparseable */,
      `{"timestamp":"2024-01-01T00:01:00Z","event":"MiningRefined","Type":"painite"}`,
    ].join("\n");
    const out = scrubJournalContent(raw).trim().split("\n");
    expect(out).toHaveLength(2);
    for (const line of out) {
      const evt = JSON.parse(line) as Record<string, unknown>;
      expect(findPiiLeaks(evt)).toEqual([]);
      expect(evt["timestamp"]).toBe("2025-06-01T12:00:00Z");
    }
  });

  it("drops lines that are valid JSON but not an event object (array / scalar / null)", () => {
    const raw = [
      `[1,2,3]`,
      `"just a string"`,
      `null`,
      `{"timestamp":"t","event":"MiningRefined","Type":"$painite_name;"}`,
    ].join("\n");
    const out = scrubJournalContent(raw).trim().split("\n");
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0] ?? "{}")).toMatchObject({ event: "MiningRefined" });
  });

  it("returns an empty string when nothing survives scrubbing", () => {
    expect(scrubJournalContent("\n  \nnot json\n[1]\n")).toBe("");
  });
});

describe("findPiiLeaks", () => {
  const OK_TS = "2025-06-01T00:00:00Z";

  it("returns no leaks for a clean event", () => {
    expect(findPiiLeaks({ timestamp: OK_TS, event: "MiningRefined", Type: "x" })).toEqual([]);
  });

  it("flags every forbidden PII field class present (top level)", () => {
    for (const field of FORBIDDEN_PII_FIELDS) {
      const leaks = findPiiLeaks({ event: "X", timestamp: OK_TS, [field]: "anything" });
      expect(leaks, `expected ${field} to be flagged`).toContain(field);
    }
  });

  it("flags a forbidden field NESTED inside an object or array", () => {
    expect(
      findPiiLeaks({ event: "CarrierStats", timestamp: OK_TS, Finance: { CarrierBalance: 123 } }),
    ).toContain("CarrierBalance");
    expect(
      findPiiLeaks({ event: "Died", timestamp: OK_TS, Killers: [{ Name: "SomeCmdr" }] }),
    ).toContain("Killers");
  });

  it("flags an identifying field that holds a real value instead of the sanctioned constant", () => {
    expect(findPiiLeaks({ event: "LoadGame", timestamp: OK_TS, Commander: "RealName" })).toContain(
      "Commander",
    );
    expect(
      findPiiLeaks({ event: "LoadGame", timestamp: OK_TS, Commander: SANITIZED_PII["Commander"] }),
    ).toEqual([]);
  });

  it("sanitizes carrier identity (Callsign/CarrierID) but not innocent commodity names", () => {
    expect(
      findPiiLeaks({ event: "CarrierStats", timestamp: OK_TS, Callsign: "ABC-123" }),
    ).toContain("Callsign");
    expect(
      findPiiLeaks({ event: "CarrierStats", timestamp: OK_TS, CarrierID: 3799999999 }),
    ).toContain("CarrierID");
    // "Name" is a commodity label here, NOT identity — must not be flagged.
    expect(
      findPiiLeaks({
        event: "ProspectedAsteroid",
        timestamp: OK_TS,
        Materials: [{ Name: "painite", Proportion: 20 }],
      }),
    ).toEqual([]);
  });

  it("treats a Fleet Carrier's Name (event-scoped) as identity unless it is the constant", () => {
    expect(
      findPiiLeaks({ event: "CarrierStats", timestamp: OK_TS, Name: "Real Carrier" }),
    ).toContain("Name");
    expect(
      findPiiLeaks({
        event: "CarrierStats",
        timestamp: OK_TS,
        Name: "LODESTAR FIXTURE CARRIER",
        Callsign: SANITIZED_PII["Callsign"],
        CarrierID: SANITIZED_PII["CarrierID"],
      }),
    ).toEqual([]);
  });

  it("flags a real (fine) timestamp — only the synthetic fixture date is allowed", () => {
    expect(findPiiLeaks({ event: "MiningRefined", timestamp: "2024-11-03T21:47:13Z" })).toContain(
      "timestamp",
    );
  });
});

describe("committed fixture corpus carries no PII", () => {
  const logs = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".log"));

  it("finds fixture files to gate", () => {
    expect(logs.length).toBeGreaterThan(0);
  });

  it("every parseable line in every committed fixture returns zero PII leaks", () => {
    for (const name of logs) {
      const text = readFileSync(join(CORPUS_DIR, name), "utf8");
      const raw = text.charCodeAt(0) === BOM ? text.slice(1) : text;
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue; // partial/truncated fragment — the tailer rejects it, nothing to leak
        }
        expect(findPiiLeaks(evt), `${name}: ${trimmed.slice(0, 70)}`).toEqual([]);
      }
    }
  });
});
