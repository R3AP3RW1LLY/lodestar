import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import type { StateInput } from "@lodestar/shared";
import { parseJournalEvent } from "../journal/events/parse.js";
import { advance, foldSessions } from "./tracker.js";
import type { Session, TrackerState } from "./tracker.js";
import { createSessionRepository } from "./repository.js";

function j(raw: string): StateInput {
  const r = parseJournalEvent(raw);
  if (!r.ok) throw new Error("bad event");
  return { kind: "journal", event: r.value };
}

/** A short active mining session (3 refined), still open. */
function activeSession(): Session {
  const inputs: StateInput[] = [
    j(
      `{"timestamp":"2025-06-01T12:00:00Z","event":"SupercruiseExit","StarSystem":"Sys","Body":"R A Ring","BodyType":"PlanetaryRing"}`,
    ),
    j(`{"timestamp":"2025-06-01T12:00:10Z","event":"LaunchDrone","Type":"Prospector"}`),
    j(`{"timestamp":"2025-06-01T12:01:00Z","event":"MiningRefined","Type":"$painite_name;"}`),
    j(`{"timestamp":"2025-06-01T12:02:00Z","event":"MiningRefined","Type":"$painite_name;"}`),
    j(`{"timestamp":"2025-06-01T12:03:00Z","event":"MiningRefined","Type":"$painite_name;"}`),
  ];
  const { active } = foldSessions(inputs);
  if (active === undefined) throw new Error("expected an active session");
  return active;
}

describe("SessionRepository", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
  });
  afterEach(() => {
    db.close();
  });

  it("migration 002 created the sessions/session_events/refinements tables", () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(["sessions", "session_events", "refinements"]));
  });

  it("saves an active session and loads it back with its totals + refinements", () => {
    const repo = createSessionRepository(db);
    const id = repo.save(activeSession());
    const loaded = repo.loadActive();
    expect(loaded?.id).toBe(id);
    expect(loaded?.session.tonsRefined).toBe(3);
    expect(loaded?.session.ship).toBe(undefined); // no LoadGame in this mini-session
    expect(loaded?.session.commodities).toEqual(["painite"]);
    // refinements persisted (3 rows)
    const refs = (db.prepare("SELECT COUNT(*) AS n FROM refinements").get() as { n: number }).n;
    expect(refs).toBe(3);
  });

  it("survives a restart mid-session: reload from DB, keep mining, totals accumulate", () => {
    const repo = createSessionRepository(db);
    const id = repo.save(activeSession());

    // "Restart": a fresh repo/tracker over the same DB reloads the active session.
    const repo2 = createSessionRepository(db);
    const loaded = repo2.loadActive();
    expect(loaded?.session.tonsRefined).toBe(3);

    // Resume the tracker from the loaded state and mine one more ton.
    const resumed: TrackerState = {
      active: loaded?.session,
      context: { docked: false },
      justEnded: [],
    };
    const next = advance(
      resumed,
      j(`{"timestamp":"2025-06-01T12:10:00Z","event":"MiningRefined","Type":"$painite_name;"}`),
    );
    expect(next.active?.tonsRefined).toBe(4);

    repo2.save(
      next.active ??
        (() => {
          throw new Error("no active");
        })(),
      loaded?.id,
    );
    expect(repo2.loadActive()?.session.tonsRefined).toBe(4);
    // Append-only: the 4th refinement was added, the first 3 not duplicated.
    expect((db.prepare("SELECT COUNT(*) AS n FROM refinements").get() as { n: number }).n).toBe(4);
    expect(id).toBe(loaded?.id);
  });

  it("never persists third-party PII (Commander/FID/unknown payloads) to session_events", () => {
    const repo = createSessionRepository(db);
    const ended = foldSessions([
      j(
        `{"timestamp":"2025-06-01T12:00:00Z","event":"LoadGame","Commander":"CMDR_SECRET","FID":"F1234567","Ship":"python","ShipName":"S"}`,
      ),
      // an unrecognized event carries a raw third-party payload — must be ignored
      j(
        `{"timestamp":"2025-06-01T12:00:05Z","event":"Friends","Status":"Online","Name":"NosyStranger"}`,
      ),
      j(
        `{"timestamp":"2025-06-01T12:00:10Z","event":"SupercruiseExit","StarSystem":"Sys","Body":"R A Ring","BodyType":"PlanetaryRing"}`,
      ),
      j(`{"timestamp":"2025-06-01T12:00:20Z","event":"LaunchDrone","Type":"Prospector"}`),
      j(`{"timestamp":"2025-06-01T12:01:00Z","event":"MiningRefined","Type":"$painite_name;"}`),
      j(
        `{"timestamp":"2025-06-01T12:02:00Z","event":"Cargo","Vessel":"Ship","Count":1,"Inventory":[{"Name":"painite","Count":1,"Stolen":0}]}`,
      ),
      j(
        `{"timestamp":"2025-06-01T12:05:00Z","event":"Docked","StationName":"S","StationType":"Coriolis","StarSystem":"Sys","SystemAddress":1,"MarketID":2}`,
      ),
      j(
        `{"timestamp":"2025-06-01T12:06:00Z","event":"MarketSell","MarketID":2,"Type":"painite","Count":1,"SellPrice":1,"TotalSale":500000,"AvgPricePaid":0}`,
      ),
    ]).ended[0];
    expect(ended).toBeDefined();
    if (ended === undefined) return;
    repo.save(ended);

    const rows = db.prepare("SELECT event_type, payload FROM session_events").all() as {
      event_type: string;
      payload: string;
    }[];
    // Only known session-relevant events are logged — never LoadGame or Unknown.
    const types = [...new Set(rows.map((r) => r.event_type))].sort();
    expect(types).toEqual(["LaunchDrone", "MarketSell", "MiningRefined"]);
    // No third-party identifiers leak into the persisted payloads.
    const blob = rows.map((r) => r.payload).join(" ");
    expect(blob).not.toMatch(/CMDR_SECRET|F1234567|NosyStranger|Commander|FID/i);
  });

  it("persists an ended session and lists it in the history", () => {
    const repo = createSessionRepository(db);
    const ended = foldSessions([
      j(
        `{"timestamp":"2025-06-01T12:00:00Z","event":"SupercruiseExit","StarSystem":"Sys","Body":"R A Ring","BodyType":"PlanetaryRing"}`,
      ),
      j(`{"timestamp":"2025-06-01T12:00:10Z","event":"LaunchDrone","Type":"Prospector"}`),
      j(`{"timestamp":"2025-06-01T12:01:00Z","event":"MiningRefined","Type":"$painite_name;"}`),
      j(
        `{"timestamp":"2025-06-01T12:02:00Z","event":"Cargo","Vessel":"Ship","Count":1,"Inventory":[{"Name":"painite","Count":1,"Stolen":0}]}`,
      ),
      j(
        `{"timestamp":"2025-06-01T12:05:00Z","event":"Docked","StationName":"S","StationType":"Coriolis","StarSystem":"Sys","SystemAddress":1,"MarketID":2}`,
      ),
      j(
        `{"timestamp":"2025-06-01T12:06:00Z","event":"MarketSell","MarketID":2,"Type":"painite","Count":1,"SellPrice":1,"TotalSale":500000,"AvgPricePaid":0}`,
      ),
    ]).ended[0];
    expect(ended).toBeDefined();
    if (ended === undefined) return;
    repo.save(ended);
    expect(repo.loadActive()).toBeUndefined(); // it's ended, not active
    const history = repo.listEnded();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ active: false, tonsRefined: 1, creditsEarned: 500000 });
  });
});
