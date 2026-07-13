import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import type { RootState, SessionSummary } from "@lodestar/shared";
import type { JournalCursor, TailerLike, WatcherFs } from "../journal/watcher.js";
import { createSessionRepository } from "../session/repository.js";
import { createLiveEngine } from "./live-engine.js";
import type { JournalCursorStore } from "./live-engine.js";

const FIXTURE_DIR = fileURLToPath(new URL("../../test/fixtures/journal/", import.meta.url));

/** All journal lines from the two-part fixture session, in order. */
function fixtureLines(): string[] {
  const files = ["Journal.2025-06-01T120000.01.log", "Journal.2025-06-01T120000.02.log"];
  return files
    .flatMap((f) => readFileSync(join(FIXTURE_DIR, f), "utf8").split(/\r?\n/))
    .map((l) => l.trim())
    .filter((l) => l !== "");
}

/** A one-shot tailer that yields the given raw lines on its first poll. */
function oneShotTailer(name: string, lines: string[]): TailerLike {
  let drained = false;
  return {
    position: 0,
    poll: () => {
      if (drained) return [];
      drained = true;
      return lines.map((raw, i) => ({ file: name, byteOffset: i, raw }));
    },
  };
}

/** fs that presents a single journal file (all fixture lines) and no live files. */
function journalOnlyFs(): WatcherFs {
  return {
    readdir: () => ["Journal.2025-06-01T120000.01.log"],
    statMtimeMs: () => null,
    readFile: () => "",
  };
}

/** fs that presents the given live files (name → raw content) and no journal. */
function liveFileFs(files: Record<string, string>): WatcherFs {
  const nameOf = (path: string): string | undefined =>
    Object.keys(files).find((n) => path.endsWith(n));
  return {
    readdir: () => [],
    statMtimeMs: (path) => (nameOf(path) === undefined ? null : 1000),
    readFile: (path) => files[nameOf(path) ?? ""] ?? "",
  };
}

describe("createLiveEngine — golden fixture replay", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
  });
  afterEach(() => {
    db.close();
  });

  it("folds the journal into the expected final RootState and persists the ended session", () => {
    const lines = fixtureLines();
    const repo = createSessionRepository(db);
    const engine = createLiveEngine({
      dir: "IGNORED",
      fs: journalOnlyFs(),
      makeTailer: (name) => oneShotTailer(name, lines),
      repository: repo,
    });

    const states: RootState[] = [];
    const sessions: (SessionSummary | null)[] = [];
    engine.onState((s) => states.push(s));
    engine.onSession((s) => sessions.push(s));

    engine.tick();

    // Final RootState (matches the Step 1.7 golden): undocked at LTT 15574, python.
    const finalState = engine.state();
    expect(finalState.location.system).toBe("LTT 15574");
    expect(finalState.location.docked).toBe(false);
    expect(finalState.ship.type).toBe("python");
    expect(finalState.activity).toBe("traveling");

    // Final session (matches the Step 1.8 golden): 5t painite sold for 2.5M, ended.
    const finalSession = engine.session();
    expect(finalSession?.active).toBe(false);
    expect(finalSession?.tonsRefined).toBe(5);
    expect(finalSession?.creditsEarned).toBe(2_500_000);
    expect(finalSession?.endedAt).toBe("2025-06-01T12:18:30Z");

    // The subscribers saw the same terminal values.
    expect(states.at(-1)).toEqual(finalState);
    expect(sessions.at(-1)).toEqual(finalSession);

    // Persistence: the session was written and is closed (not active).
    expect(repo.loadActive()).toBeUndefined();
    const history = repo.listEnded();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ tonsRefined: 5, creditsEarned: 2_500_000, active: false });
  });
});

describe("createLiveEngine — live status files + subscriber safety", () => {
  it("folds a live Status.json into RootState flags", () => {
    // A single Status.json live file (docked bitmask from the Step 1.6 real capture).
    const statusRaw = JSON.stringify({
      timestamp: "2025-06-01T13:00:00Z",
      event: "Status",
      Flags: 16842765,
      Flags2: 0,
    });
    const fs: WatcherFs = {
      readdir: () => [],
      statMtimeMs: (path) => (path.endsWith("Status.json") ? 1000 : null),
      readFile: () => statusRaw,
    };
    const engine = createLiveEngine({ dir: "IGNORED", fs });
    engine.tick();
    expect(engine.state().flags?.docked).toBe(true);
    expect(engine.state().flags?.landingGearDown).toBe(true);
  });

  it("folds a live Cargo.json into RootState cargo (limpets excluded)", () => {
    const cargoRaw = JSON.stringify({
      timestamp: "2025-06-01T13:00:00Z",
      event: "Cargo",
      Vessel: "Ship",
      Count: 13,
      Inventory: [
        { Name: "painite", Count: 3, Stolen: 0 },
        { Name: "drones", Name_Localised: "Limpets", Count: 10, Stolen: 0 },
      ],
    });
    const engine = createLiveEngine({ dir: "IGNORED", fs: liveFileFs({ "Cargo.json": cargoRaw }) });
    engine.tick();
    expect(engine.state().cargo.items).toContainEqual({ name: "painite", count: 3 });
    expect(engine.state().cargo.items.some((i) => i.name === "drones")).toBe(false);
  });

  it("ignores live files that do not feed RootState (Market.json) — no emission", () => {
    const marketRaw = JSON.stringify({ timestamp: "2025-06-01T13:00:00Z", event: "Market" });
    const engine = createLiveEngine({
      dir: "IGNORED",
      fs: liveFileFs({ "Market.json": marketRaw }),
    });
    let emissions = 0;
    engine.onState(() => {
      emissions += 1;
    });
    engine.tick();
    expect(emissions).toBe(0);
    expect(engine.state().timestamp).toBeUndefined(); // untouched initial state
  });

  it("skips a malformed journal line without emitting or throwing", () => {
    const engine = createLiveEngine({
      dir: "IGNORED",
      fs: journalOnlyFs(),
      makeTailer: (name) => oneShotTailer(name, ["}{ not json", `{"event":"NoTimestamp"}`]),
    });
    let emissions = 0;
    engine.onSession(() => {
      emissions += 1;
    });
    expect(() => {
      engine.tick();
    }).not.toThrow();
    expect(emissions).toBe(0);
    expect(engine.session()).toBeNull();
  });

  it("isolates a throwing state subscriber — others and ingestion keep running", () => {
    const engine = createLiveEngine({
      dir: "IGNORED",
      fs: journalOnlyFs(),
      makeTailer: (name) =>
        oneShotTailer(name, [
          `{"timestamp":"2025-06-01T12:00:00Z","event":"SupercruiseExit","StarSystem":"Sys","Body":"R A Ring","BodyType":"PlanetaryRing"}`,
          `{"timestamp":"2025-06-01T12:00:10Z","event":"LaunchDrone","Type":"Prospector"}`,
          `{"timestamp":"2025-06-01T12:01:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
        ]),
    });
    let goodCalls = 0;
    engine.onState(() => {
      throw new Error("subscriber boom");
    });
    engine.onState(() => {
      goodCalls += 1;
    });
    expect(() => {
      engine.tick();
    }).not.toThrow();
    expect(goodCalls).toBeGreaterThan(0);
    expect(engine.session()?.tonsRefined).toBe(1);
  });

  it("unsubscribe stops further notifications", () => {
    const engine = createLiveEngine({
      dir: "IGNORED",
      fs: journalOnlyFs(),
      makeTailer: (name) =>
        oneShotTailer(name, [
          `{"timestamp":"2025-06-01T12:00:00Z","event":"Music","MusicTrack":"MainMenu"}`,
        ]),
    });
    let calls = 0;
    const off = engine.onState(() => {
      calls += 1;
    });
    off();
    engine.tick();
    expect(calls).toBe(0);
  });

  it("start() drives an immediate cycle and stop() is clean", () => {
    const engine = createLiveEngine({
      dir: "IGNORED",
      fs: journalOnlyFs(),
      makeTailer: (name) =>
        oneShotTailer(name, [
          `{"timestamp":"2025-06-01T12:00:05Z","event":"LoadGame","Commander":"C","FID":"F","Ship":"python","ShipName":"S"}`,
        ]),
      pollIntervalMs: 100_000,
    });
    engine.start();
    expect(engine.state().ship.type).toBe("python");
    expect(() => {
      engine.stop();
    }).not.toThrow();
  });
});

const rowCount = (db: Db, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("createLiveEngine — restart resume (Step 1.9a)", () => {
  let db: Db;
  let dir: string;
  let journalPath: string;
  let cursor: JournalCursorStore & { readonly current: JournalCursor | undefined };

  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    dir = mkdtempSync(join(tmpdir(), "lodestar-engine-restart-"));
    journalPath = join(dir, "Journal.2025-06-01T120000.01.log");
    const box: { current: JournalCursor | undefined } = { current: undefined };
    cursor = {
      get current() {
        return box.current;
      },
      load: () => box.current,
      save: (c) => {
        box.current = c;
      },
    };
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const ENDED_SESSION = [
    `{"timestamp":"2025-06-01T12:00:00Z","event":"SupercruiseExit","StarSystem":"Sys","Body":"A Ring","BodyType":"PlanetaryRing"}`,
    `{"timestamp":"2025-06-01T12:00:10Z","event":"LaunchDrone","Type":"Prospector"}`,
    `{"timestamp":"2025-06-01T12:01:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
    `{"timestamp":"2025-06-01T12:02:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
    `{"timestamp":"2025-06-01T12:03:00Z","event":"Cargo","Vessel":"Ship","Count":2,"Inventory":[{"Name":"painite","Count":2,"Stolen":0}]}`,
    `{"timestamp":"2025-06-01T12:05:00Z","event":"Docked","StationName":"S","StationType":"Coriolis","StarSystem":"Sys","SystemAddress":1,"MarketID":2}`,
    `{"timestamp":"2025-06-01T12:06:00Z","event":"MarketSell","MarketID":2,"Type":"painite","Count":2,"SellPrice":1,"TotalSale":1000000,"AvgPricePaid":0}`,
  ];

  it("does not re-fold consumed lines on restart — no duplicate ended-session rows", () => {
    writeFileSync(journalPath, ENDED_SESSION.join("\n") + "\n");
    const repo = createSessionRepository(db);

    const a = createLiveEngine({ dir, repository: repo, cursorStore: cursor });
    a.tick();
    expect(repo.listEnded()).toHaveLength(1);
    expect(cursor.current).toBeDefined(); // the read position was persisted

    // "Restart": a fresh engine over the same DB + cursor must not replay the file.
    const b = createLiveEngine({ dir, repository: repo, cursorStore: cursor });
    b.tick();
    expect(repo.listEnded()).toHaveLength(1); // NOT 2
    expect(rowCount(db, "sessions")).toBe(1);
    expect(rowCount(db, "refinements")).toBe(2);
    expect(rowCount(db, "session_events")).toBe(4); // drone + 2 refine + sell, not re-inserted

    // A newly-appended session IS picked up after resume.
    appendFileSync(
      journalPath,
      [
        `{"timestamp":"2025-06-01T12:10:00Z","event":"SupercruiseExit","StarSystem":"Sys","Body":"B Ring","BodyType":"PlanetaryRing"}`,
        `{"timestamp":"2025-06-01T12:10:10Z","event":"LaunchDrone","Type":"Prospector"}`,
        `{"timestamp":"2025-06-01T12:11:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
      ].join("\n") + "\n",
    );
    b.tick();
    expect(rowCount(db, "sessions")).toBe(2); // the new active session was inserted
    expect(b.session()?.tonsRefined).toBe(1);
  });

  it("starts at EOF (no re-fold) when an active session is resumed but the cursor is lost", () => {
    // The active session's totals are in the DB, but the best-effort cursor file
    // is gone — a naive backfill from 0 would re-fold and double the totals.
    writeFileSync(
      journalPath,
      [
        `{"timestamp":"2025-06-01T12:00:00Z","event":"SupercruiseExit","StarSystem":"Sys","Body":"A Ring","BodyType":"PlanetaryRing"}`,
        `{"timestamp":"2025-06-01T12:00:10Z","event":"LaunchDrone","Type":"Prospector"}`,
        `{"timestamp":"2025-06-01T12:01:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
        `{"timestamp":"2025-06-01T12:02:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
      ].join("\n") + "\n",
    );
    const repo = createSessionRepository(db);
    const a = createLiveEngine({ dir, repository: repo, cursorStore: cursor });
    a.tick();
    expect(repo.loadActive()?.session.tonsRefined).toBe(2);
    const refsBefore = rowCount(db, "refinements");

    // Restart WITHOUT a cursor store (cursor lost) — must not re-fold the journal.
    const b = createLiveEngine({ dir, repository: repo });
    b.tick();
    expect(b.session()?.tonsRefined).toBe(2); // resumed, NOT doubled to 4
    expect(rowCount(db, "refinements")).toBe(refsBefore); // no duplicate refinement rows
    expect(rowCount(db, "sessions")).toBe(1);
  });

  it("resumes an active session's totals across restart, updating its row (no orphan)", () => {
    writeFileSync(
      journalPath,
      [
        `{"timestamp":"2025-06-01T12:00:00Z","event":"SupercruiseExit","StarSystem":"Sys","Body":"A Ring","BodyType":"PlanetaryRing"}`,
        `{"timestamp":"2025-06-01T12:00:10Z","event":"LaunchDrone","Type":"Prospector"}`,
        `{"timestamp":"2025-06-01T12:01:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
        `{"timestamp":"2025-06-01T12:02:00Z","event":"MiningRefined","Type":"$painite_name;"}`,
      ].join("\n") + "\n",
    );
    const repo = createSessionRepository(db);

    const a = createLiveEngine({ dir, repository: repo, cursorStore: cursor });
    a.tick();
    expect(repo.loadActive()?.session.tonsRefined).toBe(2);
    expect(rowCount(db, "sessions")).toBe(1);

    // Restart: the active session resumes from the DB, and the cursor prevents replay.
    const b = createLiveEngine({ dir, repository: repo, cursorStore: cursor });
    expect(b.session()?.tonsRefined).toBe(2); // resumed on construction
    b.tick();
    expect(rowCount(db, "sessions")).toBe(1); // no duplicate/orphan from replay

    // One more refine after restart accumulates onto the SAME session/row.
    appendFileSync(
      journalPath,
      `{"timestamp":"2025-06-01T12:10:00Z","event":"MiningRefined","Type":"$painite_name;"}\n`,
    );
    b.tick();
    expect(b.session()?.tonsRefined).toBe(3);
    expect(rowCount(db, "sessions")).toBe(1);
    expect(repo.loadActive()?.session.tonsRefined).toBe(3);
  });
});
