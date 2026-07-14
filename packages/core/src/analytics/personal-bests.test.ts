import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createPersonalBestsStore, sessionBestValues } from "./personal-bests.js";
import type { SessionBestInput } from "./personal-bests.js";

const sessionA: SessionBestInput = {
  sessionId: 1,
  ship: "Python",
  ring: "Paesia 2 A Ring",
  achievedAt: "2025-06-01T13:00:00Z",
  values: {
    tons_per_hour: 30,
    credits_per_hour: 30_000_000,
    single_rock_value: 5_000_000,
    longest_session: 3600,
    most_tons: 30,
  },
};

describe("personal bests", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    // `check()` runs at session end, so the referenced sessions already exist —
    // seed bare rows for the FK (personal_bests.session_id → sessions.id).
    const s = db.prepare(
      "INSERT INTO sessions (id, started_at, status) VALUES (?, '2025-06-01T12:00:00Z', 'ended')",
    );
    for (const id of [1, 2, 3]) s.run(id);
  });
  afterEach(() => db.close());

  it("migration 005 created the personal_bests table", () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toContain("personal_bests");
  });

  it("the first session sets every best once, with context", () => {
    const store = createPersonalBestsStore(db);
    const beaten = store.check(sessionA);
    expect(beaten.map((b) => b.category).sort()).toEqual([
      "credits_per_hour",
      "longest_session",
      "most_tons",
      "single_rock_value",
      "tons_per_hour",
    ]);
    const tph = store.list().find((b) => b.category === "tons_per_hour");
    expect(tph).toMatchObject({ value: 30, sessionId: 1, ship: "Python", ring: "Paesia 2 A Ring" });
  });

  it("emits each new best exactly once — re-checking the same session beats nothing", () => {
    const store = createPersonalBestsStore(db);
    store.check(sessionA);
    expect(store.check(sessionA)).toEqual([]);
  });

  it("updates only the strictly-beaten categories (equalling a best does NOT replace it)", () => {
    const store = createPersonalBestsStore(db);
    store.check(sessionA);
    const beaten = store.check({
      sessionId: 2,
      ship: "Cutter",
      ring: "Hyades B 1 A Ring",
      achievedAt: "2025-06-02T14:30:00Z",
      values: {
        tons_per_hour: 40, // beats 30 → new best
        credits_per_hour: 20_000_000, // < 30M → no
        single_rock_value: 5_000_000, // EQUALS 5M → not beaten
        longest_session: 1800, // < 3600 → no
        most_tons: 20, // < 30 → no
      },
    });
    expect(beaten.map((b) => b.category)).toEqual(["tons_per_hour"]);
    const list = store.list();
    expect(list.find((b) => b.category === "tons_per_hour")).toMatchObject({
      value: 40,
      ship: "Cutter",
    });
    // The un-beaten records still belong to session A.
    expect(list.find((b) => b.category === "most_tons")).toMatchObject({ value: 30, sessionId: 1 });
  });

  it("ignores non-positive / non-finite values (never records a zero best)", () => {
    const store = createPersonalBestsStore(db);
    const beaten = store.check({
      sessionId: 3,
      ship: null,
      ring: null,
      achievedAt: "2025-06-03T00:00:00Z",
      values: {
        tons_per_hour: 0,
        credits_per_hour: 0,
        single_rock_value: 0,
        longest_session: 0,
        most_tons: 0,
      },
    });
    expect(beaten).toEqual([]);
    expect(store.list()).toEqual([]);
  });

  it("sessionBestValues maps a session summary + single-rock value into the value set", () => {
    expect(
      sessionBestValues(
        { tonsPerHour: 35, creditsPerHour: 25_000_000, durationSec: 7200, tonsRefined: 70 },
        12_000_000,
      ),
    ).toEqual({
      tons_per_hour: 35,
      credits_per_hour: 25_000_000,
      single_rock_value: 12_000_000,
      longest_session: 7200,
      most_tons: 70,
    });
  });
});
