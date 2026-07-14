/**
 * Vein service (SSOT Step 4.13). Builds the scored hotspot candidates the Vein Finder
 * ranks: joins each hotspot to its ring (type + reserve), system (coords), overlap state
 * (4.4), and best Ledger sell price (4.11), then scores it with the Step-4.5 `scoreRing`
 * — exposing the full term breakdown so the UI can explain "why". Distance is measured
 * from the commander's origin (null when unknown). Honest overlaps: a `candidate` overlap
 * is surfaced as "possible" and (per 4.5) contributes NO score boost; only `confirmed`
 * overlaps boost. `core` may import `intelligence`; the desktop wires location + filters.
 */

import type { Db } from "@lodestar/data";
import { createOverlapRepository } from "@lodestar/data";
import type { VeinCandidate, VeinFilter, VeinOverlapState } from "@lodestar/shared";
import type { RingOverlap } from "@lodestar/intelligence";
import { scoreRing } from "@lodestar/intelligence";
import { createLedgerService } from "../market/ledger-service.js";

export interface Coords {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface VeinService {
  candidates: (filter: VeinFilter, origin: Coords | undefined, nowMs: number) => VeinCandidate[];
}

interface VeinRow {
  readonly ring_id: number;
  readonly ring_name: string;
  readonly ring_type: string | null;
  readonly reserve: string | null;
  readonly system_name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly commodity_id: string;
  readonly count: number;
  readonly source: string;
  readonly last_confirmed: string;
}

const PAD_RANK: Readonly<Record<string, number>> = { S: 1, M: 2, L: 3 };

export function createVeinService(db: Db, now: () => number): VeinService {
  const ledger = createLedgerService(db, now);
  const overlaps = createOverlapRepository(db);
  const rowsStmt = db.prepare(
    `SELECT r.id AS ring_id, r.name AS ring_name, r.ring_type, r.reserve,
            sys.name AS system_name, sys.x, sys.y, sys.z,
            h.commodity_id, h.count, h.source, h.last_confirmed
       FROM hotspots h
       JOIN rings r ON r.id = h.ring_id
       JOIN bodies b ON b.id = r.body_id
       JOIN systems sys ON sys.id = b.system_id`,
  );

  function overlapFor(ringId: number): {
    state: VeinOverlapState;
    confirmed?: RingOverlap;
    commodities: string[];
  } {
    const list = overlaps.byRing(ringId);
    const confirmed = list.find((o) => o.confidence === "confirmed");
    if (confirmed !== undefined) {
      return { state: "confirmed", confirmed, commodities: [...confirmed.commodities] };
    }
    const candidate = list[0];
    if (candidate !== undefined)
      return { state: "candidate", commodities: [...candidate.commodities] };
    return { state: "none", commodities: [] };
  }

  return {
    candidates: (filter, origin, nowMs) => {
      const out: VeinCandidate[] = [];
      for (const row of rowsStmt.all() as VeinRow[]) {
        if (filter.commodityId !== undefined && row.commodity_id !== filter.commodityId) continue;
        if (filter.reserve !== undefined && row.reserve !== filter.reserve) continue;
        if (filter.ringType !== undefined && row.ring_type !== filter.ringType) continue;

        const best = ledger.bestStations(row.commodity_id)[0];
        const padSize = best?.padSize ?? null;
        if (
          filter.minPad !== undefined &&
          (PAD_RANK[padSize ?? ""] ?? 0) < (PAD_RANK[filter.minPad] ?? 0)
        ) {
          continue;
        }
        const distanceLy =
          origin === undefined
            ? null
            : Math.sqrt(
                (row.x - origin.x) ** 2 + (row.y - origin.y) ** 2 + (row.z - origin.z) ** 2,
              );
        if (
          filter.maxDistanceLy !== undefined &&
          distanceLy !== null &&
          distanceLy > filter.maxDistanceLy
        ) {
          continue;
        }

        const overlap = overlapFor(row.ring_id);
        const breakdown = scoreRing({
          commodityId: row.commodity_id,
          price: best?.sellPrice ?? 0,
          ...(row.reserve === null ? {} : { reserve: row.reserve }),
          ...(row.ring_type === null ? {} : { ringType: row.ring_type }),
          ...(overlap.confirmed === undefined ? {} : { overlap: overlap.confirmed }),
          ...(distanceLy === null ? {} : { distanceLy }),
        });

        out.push({
          ringName: row.ring_name,
          commodityId: row.commodity_id,
          systemName: row.system_name,
          ringType: row.ring_type,
          reserve: row.reserve,
          padSize,
          hotspotCount: row.count,
          sellPrice: best?.sellPrice ?? 0,
          sellStation: best?.stationName ?? null,
          sellSystem: best?.systemName ?? null,
          distanceLy,
          overlap: overlap.state,
          overlapCommodities: overlap.commodities,
          breakdown,
          score: breakdown.score,
          source: row.source,
          updatedAtMs: Date.parse(row.last_confirmed) || nowMs,
        });
      }
      return out.sort((a, b) => b.score - a.score);
    },
  };
}
