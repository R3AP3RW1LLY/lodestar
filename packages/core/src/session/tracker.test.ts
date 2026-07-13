import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { StateInput } from "@lodestar/shared";
import { parseJournalEvent } from "../journal/events/parse.js";
import { advance, foldSessions, initialTracker, stop, summarize } from "./tracker.js";

const FIXTURE_DIR = fileURLToPath(new URL("../../test/fixtures/journal/", import.meta.url));

function j(raw: string): StateInput {
  const r = parseJournalEvent(raw);
  if (!r.ok) throw new Error(`bad event: ${JSON.stringify(r.error)}`);
  return { kind: "journal", event: r.value };
}
const ring = (ts: string, name: string): StateInput =>
  j(
    `{"timestamp":"${ts}","event":"SupercruiseExit","StarSystem":"Sys","Body":"${name}","BodyType":"PlanetaryRing"}`,
  );
const prospector = (ts: string): StateInput =>
  j(`{"timestamp":"${ts}","event":"LaunchDrone","Type":"Prospector"}`);
const refine = (ts: string, type = "$painite_name;"): StateInput =>
  j(`{"timestamp":"${ts}","event":"MiningRefined","Type":"${type}"}`);
const cargo = (ts: string, painite: number): StateInput =>
  j(
    `{"timestamp":"${ts}","event":"Cargo","Vessel":"Ship","Count":${String(painite)},"Inventory":[{"Name":"painite","Count":${String(painite)},"Stolen":0}]}`,
  );
const docked = (ts: string, stationType: string): StateInput =>
  j(
    `{"timestamp":"${ts}","event":"Docked","StationName":"S","StationType":"${stationType}","StarSystem":"Sys","SystemAddress":1,"MarketID":2}`,
  );
const sell = (ts: string, count: number, total: number): StateInput =>
  j(
    `{"timestamp":"${ts}","event":"MarketSell","MarketID":2,"Type":"painite","Count":${String(count)},"SellPrice":1,"TotalSale":${String(total)},"AvgPricePaid":0}`,
  );

function sessionInputs(): StateInput[] {
  const inputs: StateInput[] = [];
  for (const file of ["Journal.2025-06-01T120000.01.log", "Journal.2025-06-01T120000.02.log"]) {
    for (const line of readFileSync(join(FIXTURE_DIR, file), "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (t === "") continue;
      const r = parseJournalEvent(t);
      if (r.ok) inputs.push({ kind: "journal", event: r.value });
    }
  }
  return inputs;
}

describe("session tracker — golden replay of the fixture mining session", () => {
  const { ended, active } = foldSessions(sessionInputs());

  it("produces exactly one session that ended when the painite was sold to zero", () => {
    expect(ended).toHaveLength(1);
    expect(active).toBeUndefined();
  });

  it("has the exact hand-computed totals and rates", () => {
    const s = summarize(
      ended[0] ??
        (() => {
          throw new Error("no session");
        })(),
    );
    expect(s.tonsRefined).toBe(5); // 5 MiningRefined events
    expect(s.creditsEarned).toBe(2_500_000); // 5t @ 500k, at a station (not a carrier)
    expect(s.limpetsLaunched).toBe(3); // prospector, collection, prospector
    expect(s.bankedToCarrier).toBe(0);
    // start 12:05:00 (first prospector at the ring) → end 12:18:30 (sell) = 13.5 min = 0.225 h
    expect(s.tonsPerHour).toBeCloseTo(5 / 0.225, 3); // 22.22
    expect(s.creditsPerHour).toBeCloseTo(2_500_000 / 0.225, 0); // 11,111,111
    expect(s).toMatchObject({
      active: false,
      ship: "python",
      system: "Paesia",
      body: "Paesia 2 A Ring",
      ring: "Paesia 2 A Ring",
      cmdr: "CMDR_LODESTAR_FIXTURE",
      startedAt: "2025-06-01T12:05:00Z",
      endedAt: "2025-06-01T12:18:30Z",
    });
  });
});

describe("session lifecycle scenarios", () => {
  it("relog-continues: a LoadGame within 20 min at the same body keeps ONE session", () => {
    const { ended, active } = foldSessions([
      ring("2025-06-01T12:00:00Z", "R A Ring"),
      prospector("2025-06-01T12:00:10Z"),
      refine("2025-06-01T12:01:00Z"),
      j(
        `{"timestamp":"2025-06-01T12:05:00Z","event":"LoadGame","Commander":"CMDR_X","FID":"F","Ship":"python","ShipName":"S"}`,
      ),
      refine("2025-06-01T12:06:00Z"),
    ]);
    expect(ended).toHaveLength(0); // no session ended — it continued through the relog
    expect(active?.tonsRefined).toBe(2);
  });

  it("two-station sell: partial sells at two stations accumulate into one session", () => {
    const { ended } = foldSessions([
      ring("2025-06-01T12:00:00Z", "R A Ring"),
      prospector("2025-06-01T12:00:10Z"),
      refine("2025-06-01T12:01:00Z"),
      refine("2025-06-01T12:02:00Z"),
      refine("2025-06-01T12:03:00Z"),
      refine("2025-06-01T12:04:00Z"),
      refine("2025-06-01T12:05:00Z"),
      cargo("2025-06-01T12:06:00Z", 5),
      docked("2025-06-01T12:10:00Z", "Coriolis"),
      sell("2025-06-01T12:11:00Z", 2, 1_000_000),
      j(`{"timestamp":"2025-06-01T12:12:00Z","event":"Undocked","StationName":"S"}`),
      docked("2025-06-01T12:20:00Z", "Orbis"),
      sell("2025-06-01T12:21:00Z", 3, 1_500_000),
    ]);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.creditsEarned).toBe(2_500_000); // both stations' sales
    expect(ended[0]?.tonsRefined).toBe(5);
  });

  it("own-carrier sell is banked, not income (excluded from credits/hr)", () => {
    const { ended } = foldSessions([
      ring("2025-06-01T12:00:00Z", "R A Ring"),
      prospector("2025-06-01T12:00:10Z"),
      refine("2025-06-01T12:01:00Z"),
      refine("2025-06-01T12:02:00Z"),
      refine("2025-06-01T12:03:00Z"),
      cargo("2025-06-01T12:04:00Z", 3),
      docked("2025-06-01T12:10:00Z", "FleetCarrier"),
      sell("2025-06-01T12:11:00Z", 3, 1_500_000),
    ]);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.creditsEarned).toBe(0);
    expect(ended[0]?.bankedToCarrier).toBe(1_500_000);
    expect(ended[0]?.tonsRefined).toBe(3);
  });

  it("no-activity timeout: >20 min without a mining signal ends the session at last activity", () => {
    const { ended, active } = foldSessions([
      ring("2025-06-01T11:59:00Z", "R A Ring"),
      prospector("2025-06-01T12:00:00Z"),
      refine("2025-06-01T12:01:00Z"),
      // 21 minutes later, a non-mining event arrives → the session times out.
      j(
        `{"timestamp":"2025-06-01T12:22:00Z","event":"FSDJump","StarSystem":"Elsewhere","SystemAddress":9,"StarPos":[0,0,0],"JumpDist":1,"FuelUsed":1,"FuelLevel":10}`,
      ),
    ]);
    expect(active).toBeUndefined();
    expect(ended).toHaveLength(1);
    expect(ended[0]?.endedAt).toBe("2025-06-01T12:01:00Z"); // ends at last mining activity, not the jump
    expect(ended[0]?.tonsRefined).toBe(1);
  });

  it("does not start a session for a mining signal away from a ring", () => {
    const { ended, active } = foldSessions([
      prospector("2025-06-01T12:00:00Z"), // no ring context established
      refine("2025-06-01T12:01:00Z"),
    ]);
    expect(ended).toHaveLength(0);
    expect(active).toBeUndefined();
  });

  it("does not end on a sell that precedes any Cargo snapshot (no fabricated zero)", () => {
    // Without an observed Cargo baseline, a sell must not clamp the hold to zero
    // and end the session — end-detection waits for authoritative Cargo data.
    const { ended, active } = foldSessions([
      ring("2025-06-01T12:00:00Z", "R A Ring"),
      prospector("2025-06-01T12:00:10Z"),
      refine("2025-06-01T12:01:00Z"),
      refine("2025-06-01T12:02:00Z"),
      docked("2025-06-01T12:05:00Z", "Coriolis"),
      sell("2025-06-01T12:06:00Z", 2, 1_000_000), // no Cargo event yet → stays active
    ]);
    expect(ended).toHaveLength(0);
    expect(active?.creditsEarned).toBe(1_000_000);
    expect(active?.tonsRefined).toBe(2);
  });

  it("mining at a different ring closes the old session and opens a new one", () => {
    const { ended, active } = foldSessions([
      ring("2025-06-01T12:00:00Z", "A A Ring"),
      prospector("2025-06-01T12:00:10Z"),
      refine("2025-06-01T12:01:00Z"),
      // fly to a different ring, then mine there → the first session ends
      ring("2025-06-01T12:05:00Z", "B A Ring"),
      prospector("2025-06-01T12:05:10Z"),
      refine("2025-06-01T12:06:00Z"),
      refine("2025-06-01T12:07:00Z"),
    ]);
    expect(ended).toHaveLength(1);
    expect(ended[0]?.ring).toBe("A A Ring");
    expect(ended[0]?.tonsRefined).toBe(1);
    expect(ended[0]?.endedAt).toBe("2025-06-01T12:01:00Z"); // ends at ring A's last activity
    expect(active?.ring).toBe("B A Ring");
    expect(active?.tonsRefined).toBe(2);
  });

  it("a two-commodity session ends only when BOTH commodities reach zero", () => {
    const plat = (ts: string): StateInput => refine(ts, "$platinum_name;");
    const cargo2 = (ts: string, p: number, pl: number): StateInput =>
      j(
        `{"timestamp":"${ts}","event":"Cargo","Vessel":"Ship","Count":${String(p + pl)},"Inventory":[{"Name":"painite","Count":${String(p)},"Stolen":0},{"Name":"platinum","Count":${String(pl)},"Stolen":0}]}`,
      );
    const sellPlat = (ts: string, count: number, total: number): StateInput =>
      j(
        `{"timestamp":"${ts}","event":"MarketSell","MarketID":2,"Type":"platinum","Count":${String(count)},"SellPrice":1,"TotalSale":${String(total)},"AvgPricePaid":0}`,
      );
    let state = initialTracker();
    const feed = (i: StateInput): void => {
      state = advance(state, i);
    };
    feed(ring("2025-06-01T12:00:00Z", "R A Ring"));
    feed(prospector("2025-06-01T12:00:10Z"));
    feed(refine("2025-06-01T12:01:00Z")); // painite
    feed(plat("2025-06-01T12:02:00Z")); // platinum
    feed(cargo2("2025-06-01T12:03:00Z", 1, 1));
    feed(docked("2025-06-01T12:05:00Z", "Coriolis"));
    feed(sell("2025-06-01T12:06:00Z", 1, 500_000)); // painite → 0, platinum still 1
    expect(state.active).toBeDefined(); // NOT ended — platinum remains
    expect(state.justEnded).toHaveLength(0);
    feed(sellPlat("2025-06-01T12:07:00Z", 1, 600_000)); // platinum → 0 → ends
    expect(state.active).toBeUndefined();
    expect(state.justEnded).toHaveLength(1);
    expect(state.justEnded[0]?.creditsEarned).toBe(1_100_000);
  });

  it("a live-file (cargo) input drives the idle timeout, not just journal events", () => {
    const liveCargo = (ts: string): StateInput => ({
      kind: "cargo",
      cargo: { timestamp: ts, vessel: "Ship", count: 0, inventory: [] },
    });
    let state = initialTracker();
    for (const i of [
      ring("2025-06-01T12:00:00Z", "R A Ring"),
      prospector("2025-06-01T12:00:10Z"),
      refine("2025-06-01T12:01:00Z"),
    ]) {
      state = advance(state, i);
    }
    expect(state.active).toBeDefined();
    // A cargo snapshot 21 min after the last mining signal times the session out.
    const timedOut = advance(state, liveCargo("2025-06-01T12:22:00Z"));
    expect(timedOut.active).toBeUndefined();
    expect(timedOut.justEnded[0]?.endedAt).toBe("2025-06-01T12:01:00Z");
  });

  it("stop() ends the active session explicitly; a no-op when none is active", () => {
    let state = initialTracker();
    for (const i of [
      ring("2025-06-01T12:00:00Z", "R A Ring"),
      prospector("2025-06-01T12:00:10Z"),
      refine("2025-06-01T12:01:00Z"),
    ]) {
      state = advance(state, i);
    }
    expect(state.active).toBeDefined();
    const stopped = stop(state, "2025-06-01T12:10:00Z");
    expect(stopped.active).toBeUndefined();
    expect(stopped.justEnded).toHaveLength(1);
    expect(stopped.justEnded[0]?.endedAt).toBe("2025-06-01T12:10:00Z");
    expect(stop(initialTracker(), "2025-06-01T12:10:00Z").justEnded).toHaveLength(0);
  });

  it("summarizes an active session (rates from last activity; zero duration → zero rate)", () => {
    const { active } = foldSessions([
      ring("2025-06-01T12:00:00Z", "R A Ring"),
      prospector("2025-06-01T12:00:10Z"),
      refine("2025-06-01T12:06:00Z"),
    ]);
    expect(active).toBeDefined();
    if (active === undefined) return;
    const s = summarize(active);
    expect(s.active).toBe(true);
    expect(s.tonsRefined).toBe(1);
    expect(s.tonsPerHour).toBeGreaterThan(0);
    // A session whose last activity equals its start has zero elapsed → zero rate.
    expect(summarize({ ...active, lastActivityAt: active.startedAt }).tonsPerHour).toBe(0);
  });
});
