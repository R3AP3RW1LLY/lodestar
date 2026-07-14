import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createAnalyticsRepository, SESSION_EVENTS_SQL } from "./repository.js";
import { aggregateLimpets, sessionLimpets } from "./limpets.js";

describe("sessionLimpets (pure)", () => {
  it("counts launched limpets by drone type and computes collector productivity", () => {
    const e = sessionLimpets(
      [
        { eventType: "LaunchDrone", payload: '{"droneType":"Prospector"}' },
        { eventType: "LaunchDrone", payload: '{"droneType":"Collection"}' },
        { eventType: "LaunchDrone", payload: '{"droneType":"Collection"}' },
        { eventType: "LaunchDrone", payload: "not json" }, // → other
        { eventType: "MiningRefined", payload: '{"type":"painite"}' }, // not a launch
      ],
      20,
    );
    expect(e).toEqual({
      prospectorLimpets: 1,
      collectionLimpets: 2,
      otherLimpets: 1,
      tonsRefined: 20,
      collectorProductivity: 10, // 20 t / 2 collection limpets
    });
  });

  it("has zero collector productivity when no collection limpet was launched", () => {
    expect(
      sessionLimpets([{ eventType: "LaunchDrone", payload: '{"droneType":"Prospector"}' }], 5)
        .collectorProductivity,
    ).toBe(0);
  });
});

describe("aggregateLimpets (pure)", () => {
  it("pools totals and recomputes productivity over the pool", () => {
    const totals = aggregateLimpets([
      {
        prospectorLimpets: 1,
        collectionLimpets: 2,
        otherLimpets: 0,
        tonsRefined: 20,
        collectorProductivity: 10,
      },
      {
        prospectorLimpets: 2,
        collectionLimpets: 3,
        otherLimpets: 0,
        tonsRefined: 30,
        collectorProductivity: 10,
      },
    ]);
    expect(totals).toMatchObject({
      sessions: 2,
      prospectorLimpets: 3,
      collectionLimpets: 5,
      tonsRefined: 50,
      collectorProductivity: 10, // 50 / 5
    });
  });
});

describe("AnalyticsRepository.sessionEfficiency (limpets)", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    db.prepare(
      `INSERT INTO sessions (id, started_at, ended_at, ship, ring, tons_refined, limpets_launched, status)
       VALUES (1, '2025-06-01T12:00:00Z', '2025-06-01T12:10:00Z', 'Python', 'Paesia 2 A Ring', 5, 2, 'ended')`,
    ).run();
    const ev = db.prepare(
      "INSERT INTO session_events (session_id, seq, timestamp, event_type, payload) VALUES (1, ?, ?, ?, ?)",
    );
    ev.run(0, "2025-06-01T12:00:00Z", "LaunchDrone", '{"droneType":"Prospector"}');
    ev.run(1, "2025-06-01T12:00:30Z", "LaunchDrone", '{"droneType":"Collection"}');
    ev.run(2, "2025-06-01T12:01:00Z", "MiningRefined", '{"type":"painite"}');
    ev.run(3, "2025-06-01T12:02:00Z", "MiningRefined", '{"type":"painite"}');
    ev.run(4, "2025-06-01T12:09:00Z", "MiningRefined", '{"type":"painite"}');
  });
  afterEach(() => db.close());

  it("derives limpet efficiency and reconciles launches against the stored limpets_launched", () => {
    const eff = createAnalyticsRepository(db).sessionEfficiency();
    const s = eff.limpets.perSession[0];
    expect(s).toMatchObject({
      sessionId: 1,
      prospectorLimpets: 1,
      collectionLimpets: 1,
      tonsRefined: 5,
      collectorProductivity: 5,
    });
    // Reconciliation: prospector + collection + other == the session's limpets_launched.
    const launched = (
      db.prepare("SELECT limpets_launched AS n FROM sessions WHERE id = 1").get() as {
        n: number;
      }
    ).n;
    expect(s!.prospectorLimpets + s!.collectionLimpets + s!.otherLimpets).toBe(launched);
    expect(eff.limpets.totals.collectionLimpets).toBe(1);
  });

  it("the per-session events query seeks session_events via its index", () => {
    const plan = (
      db.prepare("EXPLAIN QUERY PLAN " + SESSION_EVENTS_SQL).all({ id: 1 }) as {
        detail: string;
      }[]
    )
      .map((r) => r.detail)
      .join(" | ");
    expect(plan).toContain("idx_session_events_session");
  });
});
