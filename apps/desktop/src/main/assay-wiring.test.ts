import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { initialRootState, nullLogger } from "@lodestar/shared";
import type {
  MarketSellEvent,
  MiningRefinedEvent,
  ParsedJournalEvent,
  ProspectedAsteroidEvent,
} from "@lodestar/shared";
import type { AssayVerdict, LiveEngine } from "@lodestar/core";
import { wireAssay } from "./assay-wiring.js";

function fakeEngine(): {
  engine: LiveEngine;
  fire: (event: ParsedJournalEvent) => void;
  setSession: (id: number | undefined) => void;
} {
  let cb: ((event: ParsedJournalEvent) => void) | undefined;
  let sid: number | undefined;
  const noop = (): void => undefined;
  const engine: LiveEngine = {
    start: noop,
    stop: noop,
    tick: noop,
    state: () => initialRootState(),
    session: () => null,
    sessionId: () => sid,
    lastSessionId: () => sid,
    onState: () => noop,
    onSession: () => noop,
    onEvent: (fn) => {
      cb = fn;
      return () => {
        cb = undefined;
      };
    },
  };
  return {
    engine,
    fire: (event) => cb?.(event),
    setSession: (id) => {
      sid = id;
    },
  };
}

const prospected = (over: Partial<ProspectedAsteroidEvent> = {}): ProspectedAsteroidEvent => ({
  event: "ProspectedAsteroid",
  timestamp: "2025-06-01T12:10:00Z",
  content: "$AsteroidMaterialContent_High;",
  remaining: 100,
  materials: [{ name: "painite", proportion: 30 }],
  ...over,
});
const refined = (type: string): MiningRefinedEvent => ({
  event: "MiningRefined",
  timestamp: "2025-06-01T12:11:00Z",
  type,
});
const marketSell = (sellPrice: number): MarketSellEvent => ({
  event: "MarketSell",
  timestamp: "2025-06-01T12:12:00Z",
  marketId: 42,
  type: "painite",
  count: 5,
  sellPrice,
  totalSale: sellPrice * 5,
  avgPricePaid: 0,
});

describe("assay wiring (engine → bus → orchestrator → tts)", () => {
  let db: Db;
  let sessionId: number;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    sessionId = Number(
      db
        .prepare(
          "INSERT INTO sessions (started_at, status) VALUES ('2025-06-01T12:00:00Z','active')",
        )
        .run().lastInsertRowid,
    );
  });
  afterEach(() => {
    db.close();
  });

  it("a prospect event produces a verdict (forwarded to onVerdict) and persists it", () => {
    const { engine, fire, setSession } = fakeEngine();
    const verdicts: AssayVerdict[] = [];
    const wiring = wireAssay({
      engine,
      db,
      onVerdict: (v) => verdicts.push(v),
      logger: nullLogger,
    });
    setSession(sessionId);
    fire(prospected()); // painite 30% ≥ laser 25 → MINE
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]?.call).toBe("MINE");
    const row = db.prepare("SELECT verdict FROM prospects ORDER BY id DESC LIMIT 1").get() as {
      verdict: string;
    };
    expect(row.verdict).toBe("MINE");
    wiring.dispose();
  });

  it("MiningRefined of the called commodity marks the prospect acted-on", () => {
    const { engine, fire, setSession } = fakeEngine();
    const wiring = wireAssay({ engine, db, onVerdict: () => undefined, logger: nullLogger });
    setSession(sessionId);
    fire(prospected()); // MINE painite
    fire(refined("painite")); // mined it
    const row = db.prepare("SELECT acted_on FROM prospects ORDER BY id DESC LIMIT 1").get() as {
      acted_on: number;
    };
    expect(row.acted_on).toBe(1);
    wiring.dispose();
  });

  it("MarketSell feeds the price book so the next verdict's value/t reflects it", () => {
    const { engine, fire, setSession } = fakeEngine();
    const verdicts: AssayVerdict[] = [];
    const wiring = wireAssay({
      engine,
      db,
      onVerdict: (v) => verdicts.push(v),
      logger: nullLogger,
    });
    setSession(sessionId);
    fire(marketSell(500_000)); // painite sale → price book
    fire(prospected()); // painite 30% → score = 500k × 0.30 = 150k
    expect(verdicts[0]?.score).toBeCloseTo(150_000, 5);
    wiring.dispose();
  });

  it("ignores a MiningRefined of an unknown commodity + unhandled events", () => {
    const { engine, fire, setSession } = fakeEngine();
    const verdicts: AssayVerdict[] = [];
    const wiring = wireAssay({
      engine,
      db,
      onVerdict: (v) => verdicts.push(v),
      logger: nullLogger,
    });
    setSession(sessionId);
    fire(prospected()); // MINE painite → verdict
    fire(refined("adamantium")); // unknown commodity → no acted-on, no crash
    fire({ event: "Docked", timestamp: "t", starSystem: "x" } as unknown as ParsedJournalEvent); // unhandled
    const row = db.prepare("SELECT acted_on FROM prospects ORDER BY id DESC LIMIT 1").get() as {
      acted_on: number;
    };
    expect(row.acted_on).toBe(0); // the unknown refine did not mark it
    expect(verdicts).toHaveLength(1); // only the prospect produced a verdict
    wiring.dispose();
  });

  it("dispose() unsubscribes — later events produce no more verdicts", () => {
    const { engine, fire, setSession } = fakeEngine();
    const verdicts: AssayVerdict[] = [];
    const wiring = wireAssay({
      engine,
      db,
      onVerdict: (v) => verdicts.push(v),
      logger: nullLogger,
    });
    setSession(sessionId);
    wiring.dispose();
    fire(prospected());
    expect(verdicts).toHaveLength(0);
  });
});
