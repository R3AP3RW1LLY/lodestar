import { describe, expect, it } from "vitest";
import { parseCsv, prospectsCsv, refinementsCsv, sessionsCsv, toCsv } from "./csv-export.js";
import type { SessionListItem } from "./aggregates.js";

describe("toCsv / parseCsv (RFC-4180)", () => {
  it("quotes fields containing comma, quote, or newline and doubles embedded quotes", () => {
    const csv = toCsv(
      ["a", "b", "c"],
      [
        ["plain", "has,comma", 'has "quote"'],
        ["ring\r\nbreak", 12, null],
      ],
    );
    // CRLF record separator; empty field for null.
    expect(csv).toBe(
      "a,b,c\r\n" + 'plain,"has,comma","has ""quote"""\r\n' + '"ring\r\nbreak",12,\r\n',
    );
  });

  it("round-trips tricky values back to identical strings", () => {
    const header = ["id", "ring", "note"];
    const rows = [
      [1, "Paesia 2 A, Ring", 'a "weird" ring'],
      [2, "line\nbreak", "trailing space "],
      [3, "", "normal"],
    ];
    const parsed = parseCsv(toCsv(header, rows));
    expect(parsed[0]).toEqual(header);
    expect(parsed[1]).toEqual(["1", "Paesia 2 A, Ring", 'a "weird" ring']);
    expect(parsed[2]).toEqual(["2", "line\nbreak", "trailing space "]);
    expect(parsed[3]).toEqual(["3", "", "normal"]);
    expect(parsed).toHaveLength(4);
  });

  it("prepends a UTF-8 BOM when requested and parseCsv strips it", () => {
    const csv = toCsv(["x"], [["y"]], { bom: true });
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(parseCsv(csv)).toEqual([["x"], ["y"]]);
  });
});

describe("typed exporters", () => {
  const session: SessionListItem = {
    id: 1,
    startedAt: "2025-06-01T12:00:00Z",
    endedAt: "2025-06-01T13:00:00Z",
    ship: "Python",
    system: "Paesia",
    ring: "Paesia 2 A Ring",
    tonsRefined: 30,
    creditsEarned: 30_000_000,
    limpetsLaunched: 40,
    durationSec: 3600,
    tonsPerHour: 30,
    creditsPerHour: 30_000_000,
    prospected: 4,
    mineVerdicts: 3,
  };

  it("sessionsCsv writes a header + one row per session", () => {
    const parsed = parseCsv(sessionsCsv([session]));
    expect(parsed[0]?.[0]).toBe("id");
    expect(parsed[1]?.[0]).toBe("1");
    expect(parsed[1]?.[5]).toBe("Paesia 2 A Ring");
    expect(parsed).toHaveLength(2);
  });

  it("refinementsCsv + prospectsCsv emit headers and rows", () => {
    const refs = parseCsv(
      refinementsCsv([
        { sessionId: 1, timestamp: "2025-06-01T12:10:00Z", commodity: "painite", tons: 20 },
      ]),
    );
    expect(refs[0]).toEqual(["session_id", "timestamp", "commodity", "tons"]);
    expect(refs[1]).toEqual(["1", "2025-06-01T12:10:00Z", "painite", "20"]);

    const pros = parseCsv(
      prospectsCsv([
        {
          id: 7,
          sessionId: 1,
          timestamp: "2025-06-01T12:05:00Z",
          content: "$AsteroidMaterialContent_High;",
          remainingPct: 100,
          motherlode: "painite",
          verdict: "MINE",
          actedOn: 1,
        },
      ]),
    );
    expect(pros[0]?.[0]).toBe("id");
    expect(pros[1]).toEqual([
      "7",
      "1",
      "2025-06-01T12:05:00Z",
      "$AsteroidMaterialContent_High;",
      "100",
      "painite",
      "MINE",
      "1",
    ]);
  });
});
