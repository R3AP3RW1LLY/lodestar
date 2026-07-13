import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { EventBus } from "../bus/event-bus.js";
import { parseJournalEvent } from "../journal/events/parse.js";
import { toProspect } from "../journal/events/prospected-asteroid.js";
import type { Prospect } from "../journal/events/prospected-asteroid.js";
import { createProspectRepository } from "../session/prospect-repository.js";
import { createThresholdOverridesStore } from "../settings/threshold-overrides.js";
import { createPriceBookStore } from "../market/price-book.js";
import { parseMarket } from "../livefiles/market.js";
import type { MarketSnapshot } from "@lodestar/shared";
import { createAssayOrchestrator } from "./orchestrator.js";
import type { AssayEvents, AssayVerdict } from "./orchestrator.js";

/** Parse a raw ProspectedAsteroid line into a Prospect observation. */
function prospect(raw: string): Prospect {
  const r = parseJournalEvent(raw);
  if (!r.ok || r.value.event !== "ProspectedAsteroid") throw new Error(`not a prospect: ${raw}`);
  return toProspect(r.value);
}

// painite 30% (≥ laser threshold 25) — MINE via proportion; platinum has no price.
const MINE_PAINITE = `{"timestamp":"2025-06-01T12:10:00Z","event":"ProspectedAsteroid","Materials":[{"Name":"painite","Proportion":30.0},{"Name":"platinum","Proportion":8.0}],"Content":"$AsteroidMaterialContent_High;","Remaining":100.0}`;
// motherlode painite at a sub-threshold 12% — MINE via the motherlode rule.
const MOTHERLODE = `{"timestamp":"2025-06-01T12:11:00Z","event":"ProspectedAsteroid","Materials":[{"Name":"painite","Proportion":12.0}],"Content":"$AsteroidMaterialContent_Medium;","Remaining":100.0,"MotherlodeMaterial":"painite"}`;
// rutile 3% — no threshold → SKIP.
const SKIP_RUTILE = `{"timestamp":"2025-06-01T12:12:00Z","event":"ProspectedAsteroid","Materials":[{"Name":"rutile","Proportion":3.0}],"Content":"$AsteroidMaterialContent_Low;","Remaining":100.0}`;
// painite 30% but fully depleted — SKIP (already-depleted beats everything).
const DEPLETED = `{"timestamp":"2025-06-01T12:13:00Z","event":"ProspectedAsteroid","Materials":[{"Name":"painite","Proportion":30.0}],"Content":"$AsteroidMaterialContent_High;","Remaining":0.0}`;

function marketPainite(sell: number): MarketSnapshot {
  const raw = `{"timestamp":"2025-06-01T12:00:00Z","event":"Market","MarketID":100,"StationName":"S","StarSystem":"Sys","Items":[{"id":1,"Name":"$painite_name;","Name_Localised":"Painite","Category":"c","BuyPrice":0,"SellPrice":${String(sell)},"MeanPrice":0,"Demand":1,"Stock":0}]}`;
  const r = parseMarket(raw);
  if (!r.ok) throw new Error("bad market fixture");
  return r.value;
}

describe("assay orchestrator (bus → verdict → persist → acted-on)", () => {
  let db: Db;
  let sessionId: number;
  let bus: EventBus<AssayEvents>;
  let verdicts: AssayVerdict[];
  let dispose: () => void;

  function wire(
    opts: { withPainitePrice?: number } = {},
  ): ReturnType<typeof createProspectRepository> {
    const prospects = createProspectRepository(db);
    const priceBook = createPriceBookStore(db);
    if (opts.withPainitePrice !== undefined)
      priceBook.ingestMarket(marketPainite(opts.withPainitePrice));
    const orch = createAssayOrchestrator({
      bus,
      prospects,
      overrides: createThresholdOverridesStore(db),
      priceBook: priceBook.resolver(),
    });
    dispose = orch.dispose;
    return prospects;
  }

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
    bus = new EventBus<AssayEvents>();
    verdicts = [];
    bus.subscribe("verdict", (v) => verdicts.push(v));
  });
  afterEach(() => {
    dispose();
    db.close();
  });

  it("prospect in → verdict persisted + emitted with the correct reasons", () => {
    const prospects = wire();
    bus.publish("prospected", { prospect: prospect(MINE_PAINITE), sessionId, method: "laser" });

    // Emitted on the bus.
    expect(verdicts).toHaveLength(1);
    const v = verdicts[0];
    expect(v?.call).toBe("MINE");
    expect(v?.method).toBe("laser");
    expect(v?.timestamp).toBe("2025-06-01T12:10:00Z");
    expect(v?.reasons.some((r) => r.code === "proportion-above-threshold")).toBe(true);

    // Persisted onto the prospect row (verdict + structured reasoning JSON).
    const row = prospects.listBySession(sessionId)[0];
    expect(row?.verdict).toBe("MINE");
    expect(row?.actedOn).toBe(false);
    const reasons = JSON.parse(row?.reasoning ?? "[]") as { code: string; commodityId?: string }[];
    expect(reasons.find((r) => r.code === "proportion-above-threshold")?.commodityId).toBe(
      "painite",
    );
  });

  it("value/t reflects the live price book (docking changes the verdict score)", () => {
    wire({ withPainitePrice: 500_000 });
    bus.publish("prospected", { prospect: prospect(MINE_PAINITE), sessionId, method: "laser" });
    // painite 30% × 500k = 150k; platinum has no price → 0.
    expect(verdicts[0]?.score).toBeCloseTo(150_000, 5);
  });

  it("a SKIP prospect is persisted as SKIP and opens no acted-on window", () => {
    const prospects = wire();
    bus.publish("prospected", { prospect: prospect(SKIP_RUTILE), sessionId, method: "laser" });
    expect(verdicts[0]?.call).toBe("SKIP");
    // A refine after a SKIP never marks anything acted-on (no open rock).
    bus.publish("refined", { commodityId: "rutile", sessionId });
    expect(prospects.listBySession(sessionId)[0]?.actedOn).toBe(false);
  });

  it("depleted rock → SKIP even at a mineable proportion", () => {
    wire({ withPainitePrice: 500_000 });
    bus.publish("prospected", { prospect: prospect(DEPLETED), sessionId, method: "laser" });
    expect(verdicts[0]?.call).toBe("SKIP");
    expect(verdicts[0]?.reasons[0]?.code).toBe("already-depleted");
  });

  it("mined-after-MINE: a MiningRefined of the called commodity marks the prospect acted-on", () => {
    const prospects = wire();
    bus.publish("prospected", { prospect: prospect(MINE_PAINITE), sessionId, method: "laser" });
    bus.publish("refined", { commodityId: "painite", sessionId });
    expect(prospects.listBySession(sessionId)[0]?.actedOn).toBe(true);
  });

  it("a refine of a DIFFERENT commodity does not mark the MINE prospect acted-on", () => {
    const prospects = wire();
    bus.publish("prospected", { prospect: prospect(MINE_PAINITE), sessionId, method: "laser" });
    bus.publish("refined", { commodityId: "platinum", sessionId }); // not the called commodity
    expect(prospects.listBySession(sessionId)[0]?.actedOn).toBe(false);
  });

  it("a refine in a DIFFERENT session does not bleed across sessions", () => {
    const other = Number(
      db
        .prepare(
          "INSERT INTO sessions (started_at, status) VALUES ('2025-06-01T13:00:00Z','active')",
        )
        .run().lastInsertRowid,
    );
    const prospects = wire();
    bus.publish("prospected", { prospect: prospect(MINE_PAINITE), sessionId, method: "laser" });
    bus.publish("refined", { commodityId: "painite", sessionId: other }); // wrong session
    expect(prospects.listBySession(sessionId)[0]?.actedOn).toBe(false);
  });

  it("the acted-on window closes at the next prospect (temporal, no rock identity)", () => {
    const prospects = wire();
    bus.publish("prospected", { prospect: prospect(MINE_PAINITE), sessionId, method: "laser" }); // rock 1
    bus.publish("prospected", { prospect: prospect(MINE_PAINITE), sessionId, method: "laser" }); // rock 2 supersedes
    bus.publish("refined", { commodityId: "painite", sessionId }); // attributed to the current (rock 2)
    const rows = prospects.listBySession(sessionId);
    expect(rows[0]?.actedOn).toBe(false); // rock 1's window had closed
    expect(rows[1]?.actedOn).toBe(true); // rock 2 is the open rock
  });

  it("deep-core: AsteroidCracked marks the open prospect acted-on AND flags it cracked", () => {
    const prospects = wire();
    bus.publish("prospected", { prospect: prospect(MOTHERLODE), sessionId, method: "deep-core" });
    expect(verdicts[0]?.call).toBe("MINE"); // motherlode rule
    bus.publish("cracked", { sessionId });
    const row = prospects.listBySession(sessionId)[0];
    expect(row?.actedOn).toBe(true);
    expect(row?.cracked).toBe(true);
  });

  it("a crack after an intervening SKIP never pollutes the SKIP rock (flags the OPEN rock only)", () => {
    const prospects = wire();
    bus.publish("prospected", { prospect: prospect(MOTHERLODE), sessionId, method: "deep-core" }); // A: MINE, open
    bus.publish("prospected", { prospect: prospect(SKIP_RUTILE), sessionId, method: "deep-core" }); // B: SKIP closes the window
    bus.publish("cracked", { sessionId });
    const rows = prospects.listBySession(sessionId);
    // The window closed at B, so the crack attributes to nothing — B (a SKIP) is
    // never flagged cracked (the bug a "most recent" heuristic would cause).
    expect(rows[1]?.cracked).toBe(false);
    expect(rows[1]?.actedOn).toBe(false);
    expect(rows[0]?.cracked).toBe(false); // A's window had already closed
  });

  it("calls the speak hook once per verdict (the TTS queue subscribes here in 2.7)", () => {
    const prospects = createProspectRepository(db);
    const spoken: AssayVerdict[] = [];
    const orch = createAssayOrchestrator({
      bus,
      prospects,
      overrides: createThresholdOverridesStore(db),
      priceBook: createPriceBookStore(db).resolver(),
      speak: (v) => spoken.push(v),
    });
    dispose = orch.dispose;
    bus.publish("prospected", { prospect: prospect(MINE_PAINITE), sessionId, method: "laser" });
    expect(spoken).toHaveLength(1);
    expect(spoken[0]?.call).toBe("MINE");
  });

  it("never breaks the bus: a failing prospect is isolated, the next one still assays", () => {
    const prospects = wire();
    // A non-existent session id violates the prospects FK → save throws inside the
    // handler. The bus would DETACH a throwing subscriber; the orchestrator must
    // swallow it so the pipeline survives.
    expect(() => {
      bus.publish("prospected", {
        prospect: prospect(MINE_PAINITE),
        sessionId: 999_999,
        method: "laser",
      });
    }).not.toThrow();
    expect(verdicts).toHaveLength(0); // the failing prospect produced no verdict

    // The subscription is still live — a valid prospect assays normally.
    bus.publish("prospected", { prospect: prospect(MINE_PAINITE), sessionId, method: "laser" });
    expect(verdicts).toHaveLength(1);
    expect(prospects.listBySession(sessionId)[0]?.verdict).toBe("MINE");
  });

  it("applies a user threshold override live (overrides win over the pure defaults)", () => {
    const prospects = wire();
    // Raise the painite laser threshold above 30% → the same rock now SKIPs.
    createThresholdOverridesStore(db).set({
      commodityId: "painite",
      method: "laser",
      minProportion: 40,
    });
    bus.publish("prospected", { prospect: prospect(MINE_PAINITE), sessionId, method: "laser" });
    expect(verdicts[0]?.call).toBe("SKIP");
    expect(prospects.listBySession(sessionId)[0]?.verdict).toBe("SKIP");
  });

  it("isolates a DB failure in the refined/cracked handlers (never breaks the bus)", () => {
    // A separate DB the test can close mid-flight to force the acted-on UPDATEs to
    // throw — proving those handlers swallow errors rather than detaching.
    const local = openDatabase(":memory:");
    applyMigrations(local, MIGRATIONS);
    const sid = Number(
      local
        .prepare(
          "INSERT INTO sessions (started_at, status) VALUES ('2025-06-01T12:00:00Z','active')",
        )
        .run().lastInsertRowid,
    );
    const orch = createAssayOrchestrator({
      bus,
      prospects: createProspectRepository(local),
      overrides: createThresholdOverridesStore(local),
      priceBook: createPriceBookStore(local).resolver(),
    });
    dispose = orch.dispose;
    bus.publish("prospected", {
      prospect: prospect(MINE_PAINITE),
      sessionId: sid,
      method: "laser",
    }); // opens the window
    local.close(); // every subsequent prospects.* call now throws

    expect(() => {
      bus.publish("refined", { commodityId: "painite", sessionId: sid });
    }).not.toThrow();
    expect(() => {
      bus.publish("cracked", { sessionId: sid });
    }).not.toThrow();
  });
});
