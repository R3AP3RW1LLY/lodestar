import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMigrations, MIGRATIONS, openDatabase } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { createLedgerBridge, emptyLedgerBridge } from "./ledger-wiring.js";

const NOW = Date.parse("2025-06-01T12:00:00Z");

describe("ledger bridge", () => {
  let db: Db;
  beforeEach(() => {
    db = openDatabase(":memory:");
    applyMigrations(db, MIGRATIONS);
    db.prepare(
      `INSERT INTO market_snapshots (commodity_id, market_id, sell_price, source, source_ts, station_name, star_system, pad_size, demand)
       VALUES ('painite', 1, 500000, 'journal', '2025-06-01T12:00:00Z', 'Nemere', 'Paesia', 'L', 900)`,
    ).run();
  });
  afterEach(() => db.close());

  const bridge = () =>
    createLedgerBridge(
      db,
      () => NOW,
      () => "2025-06-01T00:00:00Z",
      vi.fn(),
    );

  it("maps the board (best undefined → null) and returns ranked stations", () => {
    const b = bridge();
    const board = b.board();
    expect(board).toHaveLength(1);
    expect(board[0]?.commodityId).toBe("painite");
    expect(board[0]?.best?.stationName).toBe("Nemere");
    expect(b.stations({ commodityId: "painite" })[0]?.source).toBe("journal");
    expect(b.stations({ commodityId: "unknown" })).toEqual([]);
  });

  it("passes station filters (pad, demand, distance) + trend through", () => {
    expect(bridge().stations({ commodityId: "painite", minPad: "L" })).toHaveLength(1);
    expect(
      bridge().stations({ commodityId: "painite", minPad: "L", minDemand: 5000 }),
    ).toHaveLength(0);
    // A distance filter is a no-op when snapshots carry no distanceLs (still returns the row).
    expect(bridge().stations({ commodityId: "painite", maxDistanceLs: 100 })).toHaveLength(1);
    expect(bridge().trend({ commodityId: "painite", bucketMs: 86_400_000 }).length).toBeGreaterThan(
      0,
    );
  });

  it("manages alert rules (add → list, toggle, delete)", () => {
    const b = bridge();
    const afterAdd = b.addAlert({ kind: "cargo-full", threshold: 80 });
    expect(afterAdd).toHaveLength(1);
    const id = afterAdd[0]?.id ?? 0;
    expect(b.setAlertEnabled(id, false)[0]?.enabled).toBe(false);
    expect(b.deleteAlert(id)).toEqual([]);
  });

  it("empty bridge returns empties for an absent DB", () => {
    const e = emptyLedgerBridge();
    expect(e.board()).toEqual([]);
    expect(e.stations({ commodityId: "painite" })).toEqual([]);
    expect(e.trend({ commodityId: "painite", bucketMs: 1000 })).toEqual([]);
    expect(e.listAlerts()).toEqual([]);
    expect(e.addAlert({ kind: "cargo-full", threshold: 80 })).toEqual([]);
    expect(e.setAlertEnabled(1, true)).toEqual([]);
    expect(e.deleteAlert(1)).toEqual([]);
  });
});
