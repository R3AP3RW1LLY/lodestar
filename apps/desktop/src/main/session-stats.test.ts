import { describe, expect, it } from "vitest";
import type { ProspectRepository, StoredProspect } from "@lodestar/core";
import type { SessionSummary } from "@lodestar/shared";
import { enrichSessionStats } from "./session-stats.js";

const summary = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  active: true,
  startedAt: "2025-06-01T12:00:00Z",
  tonsRefined: 0,
  tonsPerHour: 0,
  creditsEarned: 0,
  creditsPerHour: 0,
  limpetsLaunched: 0,
  bankedToCarrier: 0,
  ...over,
});

const prospect = (verdict: "MINE" | "SKIP", name: string, proportion: number): StoredProspect => ({
  id: 1,
  sessionId: 1,
  timestamp: "2025-06-01T12:05:00Z",
  content: "$AsteroidMaterialContent_High;",
  remainingPct: 100,
  materials: [{ name, proportion }],
  cracked: false,
  verdict,
  reasoning: undefined,
  actedOn: false,
});

function fakeRepo(bySession: Record<number, StoredProspect[]>): ProspectRepository {
  return {
    save: () => 0,
    saveVerdict: () => undefined,
    markActedOn: () => false,
    markCracked: () => false,
    listBySession: (id) => bySession[id] ?? [],
    listRecent: () => [],
  };
}

describe("enrichSessionStats", () => {
  it("returns null for no active session", () => {
    expect(enrichSessionStats(null, 1, fakeRepo({}))).toBeNull();
  });

  it("attaches empty stats when there is no repo or no session id", () => {
    expect(enrichSessionStats(summary(), 1, undefined)?.prospectStats?.prospected).toBe(0);
    expect(enrichSessionStats(summary(), undefined, fakeRepo({}))?.prospectStats?.prospected).toBe(
      0,
    );
  });

  it("computes live stats from the session's prospects", () => {
    const repo = fakeRepo({ 7: [prospect("MINE", "painite", 30), prospect("SKIP", "rutile", 3)] });
    const stats = enrichSessionStats(summary(), 7, repo)?.prospectStats;
    expect(stats?.prospected).toBe(2);
    expect(stats?.mineVerdicts).toBe(1);
    expect(stats?.hitRate).toBeCloseTo(0.5, 10);
  });

  it("KEEPS stats on an ENDED session — the review-your-haul moment doesn't zero out", () => {
    const repo = fakeRepo({
      7: [prospect("MINE", "painite", 30), prospect("MINE", "platinum", 40)],
    });
    // A session that has ended: active:false, but lastSessionId still points at row 7.
    const ended = summary({ active: false, endedAt: "2025-06-01T12:30:00Z" });
    const stats = enrichSessionStats(ended, 7, repo)?.prospectStats;
    expect(stats?.prospected).toBe(2);
    expect(stats?.mineVerdicts).toBe(2);
    expect(stats?.hitRate).toBe(1);
  });
});
