import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isErr, isOk } from "@lodestar/shared";
import { openDatabase, applyMigrations, MIGRATIONS } from "./index.js";
import type { Db } from "./db.js";
import { parseSeedFile, importSeed } from "./seed-import.js";
import type { SeedFile } from "./seed-import.js";

/** A minimal, structurally-valid seed used to exercise the import pipeline. */
const validSeed: SeedFile = {
  version: 1,
  note: "test fixture",
  systems: [
    {
      name: "Testonia",
      coords: { x: 1, y: 2, z: 3 },
      coordsApproximate: true,
      bodies: [
        {
          name: "Testonia A 1",
          bodyType: "Metal-rich body",
          rings: [
            {
              name: "Testonia A 1 A Ring",
              ringType: "Metallic",
              reserve: "Pristine",
              provenance: "hand-authored test fixture",
              hotspots: [{ commodityId: "painite", count: 2 }, { commodityId: "platinum" }],
            },
          ],
        },
      ],
    },
  ],
};

describe("parseSeedFile — validation", () => {
  it("accepts a well-formed seed", () => {
    const result = parseSeedFile(validSeed);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.systems[0]?.name).toBe("Testonia");
  });

  it("accepts the JSON-round-tripped form (readonly arrays tolerated)", () => {
    const result = parseSeedFile(JSON.parse(JSON.stringify(validSeed)) as unknown);
    expect(isOk(result)).toBe(true);
  });

  it.each([
    ["not an object", 42, "seed/not-object"],
    ["null", null, "seed/not-object"],
    ["bad version", { version: 0, systems: [] }, "seed/bad-version"],
    ["no systems array", { version: 1, systems: "x" }, "seed/no-systems"],
    ["empty systems", { version: 1, systems: [] }, "seed/no-systems"],
  ])("rejects %s", (_label, raw, code) => {
    const result = parseSeedFile(raw);
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe(code);
  });

  it("rejects a system with no name", () => {
    const bad = { version: 1, systems: [{ name: "", coords: { x: 0, y: 0, z: 0 }, bodies: [] }] };
    const result = parseSeedFile(bad);
    expect(isErr(result) && result.error.code).toBe("seed/bad-system");
  });

  it("rejects non-finite coordinates", () => {
    const bad = {
      version: 1,
      systems: [{ name: "X", coords: { x: Number.NaN, y: 0, z: 0 }, bodies: [] }],
    };
    const result = parseSeedFile(bad);
    expect(isErr(result) && result.error.code).toBe("seed/bad-coords");
  });

  it("rejects a system with no bodies", () => {
    const bad = { version: 1, systems: [{ name: "X", coords: { x: 0, y: 0, z: 0 }, bodies: [] }] };
    const result = parseSeedFile(bad);
    expect(isErr(result) && result.error.code).toBe("seed/bad-system");
  });

  it("rejects a body with no rings", () => {
    const bad = {
      version: 1,
      systems: [{ name: "X", coords: { x: 0, y: 0, z: 0 }, bodies: [{ name: "X A", rings: [] }] }],
    };
    const result = parseSeedFile(bad);
    expect(isErr(result) && result.error.code).toBe("seed/bad-body");
  });

  it("rejects a ring with blank provenance", () => {
    const bad = {
      version: 1,
      systems: [
        {
          name: "X",
          coords: { x: 0, y: 0, z: 0 },
          bodies: [
            {
              name: "X A",
              rings: [
                {
                  name: "X A A Ring",
                  provenance: "   ",
                  hotspots: [{ commodityId: "painite" }],
                },
              ],
            },
          ],
        },
      ],
    };
    const result = parseSeedFile(bad);
    expect(isErr(result) && result.error.code).toBe("seed/missing-provenance");
  });

  it("rejects a ring with no hotspots", () => {
    const bad = {
      version: 1,
      systems: [
        {
          name: "X",
          coords: { x: 0, y: 0, z: 0 },
          bodies: [{ name: "X A", rings: [{ name: "X A A Ring", provenance: "p", hotspots: [] }] }],
        },
      ],
    };
    const result = parseSeedFile(bad);
    expect(isErr(result) && result.error.code).toBe("seed/bad-ring");
  });

  it("rejects an unknown commodity id", () => {
    const bad = {
      version: 1,
      systems: [
        {
          name: "X",
          coords: { x: 0, y: 0, z: 0 },
          bodies: [
            {
              name: "X A",
              rings: [
                { name: "X A A Ring", provenance: "p", hotspots: [{ commodityId: "unobtanium" }] },
              ],
            },
          ],
        },
      ],
    };
    const result = parseSeedFile(bad);
    expect(isErr(result) && result.error.code).toBe("seed/unknown-commodity");
  });

  it.each([0, -1, 2.5, Number.NaN])(
    "rejects a non-positive-integer hotspot count (%s)",
    (count) => {
      const bad = {
        version: 1,
        systems: [
          {
            name: "X",
            coords: { x: 0, y: 0, z: 0 },
            bodies: [
              {
                name: "X A",
                rings: [
                  {
                    name: "X A A Ring",
                    provenance: "p",
                    hotspots: [{ commodityId: "painite", count }],
                  },
                ],
              },
            ],
          },
        ],
      };
      const result = parseSeedFile(bad);
      expect(isErr(result) && result.error.code).toBe("seed/bad-hotspot");
    },
  );

  const wrap = (rings: unknown, bodyName = "X A", address?: unknown): unknown => ({
    version: 1,
    systems: [
      {
        name: "X",
        coords: { x: 0, y: 0, z: 0 },
        ...(address === undefined ? {} : { address }),
        bodies: [{ name: bodyName, rings }],
      },
    ],
  });

  it("rejects a hotspot with no commodityId", () => {
    const result = parseSeedFile(
      wrap([{ name: "X A A Ring", provenance: "p", hotspots: [{ count: 2 }] }]),
    );
    expect(isErr(result) && result.error.code).toBe("seed/bad-hotspot");
  });

  it("rejects a ring with no name", () => {
    const result = parseSeedFile(
      wrap([{ provenance: "p", hotspots: [{ commodityId: "painite" }] }]),
    );
    expect(isErr(result) && result.error.code).toBe("seed/bad-ring");
  });

  it("rejects a body with no name", () => {
    const result = parseSeedFile(
      wrap([{ name: "X A A Ring", provenance: "p", hotspots: [{ commodityId: "painite" }] }], ""),
    );
    expect(isErr(result) && result.error.code).toBe("seed/bad-body");
  });

  it("rejects a system with a non-numeric address", () => {
    const result = parseSeedFile(
      wrap(
        [{ name: "X A A Ring", provenance: "p", hotspots: [{ commodityId: "painite" }] }],
        "X A",
        "not-a-number",
      ),
    );
    expect(isErr(result) && result.error.code).toBe("seed/bad-system");
  });

  it("accepts optional ringType/reserve/bodyType being absent (defaults to null on import)", () => {
    const result = parseSeedFile(
      wrap([{ name: "X A A Ring", provenance: "p", hotspots: [{ commodityId: "painite" }] }]),
    );
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    importSeed(db, result.value, "t");
    const ring = db.prepare("SELECT ring_type, reserve FROM rings").get() as {
      ring_type: string | null;
      reserve: string | null;
    };
    expect(ring).toEqual({ ring_type: null, reserve: null });
    db.close();
  });
});

describe("importSeed — pipeline + idempotency", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
  });
  afterEach(() => db.close());

  const countRows = (table: string): number =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

  it("imports the full hierarchy with source='seed'", () => {
    const summary = importSeed(db, validSeed, "2025-06-01T00:00:00Z");
    expect(summary).toEqual({ systems: 1, bodies: 1, rings: 1, hotspots: 2 });
    expect(countRows("systems")).toBe(1);
    expect(countRows("bodies")).toBe(1);
    expect(countRows("rings")).toBe(1);
    expect(countRows("hotspots")).toBe(2);
    const sources = (
      db.prepare("SELECT DISTINCT source FROM hotspots").all() as { source: string }[]
    ).map((r) => r.source);
    expect(sources).toEqual(["seed"]);
  });

  it("is idempotent — a re-import creates no duplicate rows and keeps first_seen", () => {
    importSeed(db, validSeed, "2025-06-01T00:00:00Z");
    const again = importSeed(db, validSeed, "2025-07-01T00:00:00Z");
    expect(again).toEqual({ systems: 1, bodies: 1, rings: 1, hotspots: 2 });
    expect(countRows("systems")).toBe(1);
    expect(countRows("hotspots")).toBe(2);
    const painite = db
      .prepare("SELECT first_seen, last_confirmed FROM hotspots WHERE commodity_id = 'painite'")
      .get() as { first_seen: string; last_confirmed: string };
    expect(painite.first_seen).toBe("2025-06-01T00:00:00Z"); // preserved
    expect(painite.last_confirmed).toBe("2025-07-01T00:00:00Z"); // refreshed
  });
});

describe("shipped seed dataset (resources/seed/hotspots-seed.json)", () => {
  const raw: unknown = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../resources/seed/hotspots-seed.json", import.meta.url)),
      "utf8",
    ),
  );

  it("parses, and every entry carries provenance + honest coordinate flagging", () => {
    const result = parseSeedFile(raw);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;
    const seed = result.value;
    expect(seed.systems.length).toBeGreaterThan(0);
    for (const system of seed.systems) {
      // Every seed system's coordinates are honestly flagged approximate (refined by EDSM, Step 4.7).
      expect(system.coordsApproximate).toBe(true);
      for (const body of system.bodies) {
        for (const ring of body.rings) {
          expect(ring.provenance.trim().length).toBeGreaterThan(0);
          expect(ring.hotspots.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("imports cleanly and idempotently into a fresh galaxy DB", () => {
    const parsed = parseSeedFile(raw);
    expect(isOk(parsed)).toBe(true);
    if (!isOk(parsed)) return;
    const db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    const first = importSeed(db, parsed.value, "2025-06-01T00:00:00Z");
    const second = importSeed(db, parsed.value, "2025-06-02T00:00:00Z");
    expect(second).toEqual(first);
    const hotspotCount = (db.prepare("SELECT COUNT(*) AS n FROM hotspots").get() as { n: number })
      .n;
    expect(hotspotCount).toBe(first.hotspots);
    const nonSeed = (
      db.prepare("SELECT COUNT(*) AS n FROM hotspots WHERE source <> 'seed'").get() as { n: number }
    ).n;
    expect(nonSeed).toBe(0);
    db.close();
  });
});
