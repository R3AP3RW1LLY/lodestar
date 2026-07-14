/**
 * SAASignalsFound interpreter (SSOT Step 4.3, pure). The same journal event fires for
 * a DSS-mapped **ring** (commodity hotspots) and for a planetary **surface** (biological
 * / geological signals), so this module does two things:
 *   - parses the ring's parent body out of the ring name ("<body> <letter> Ring"), and
 *   - maps each `$SAA_SignalType_…;` to a canonical commodity id (Step 2.2), dropping
 *     every non-mineral signal (biological/geological/human/…).
 * If the body isn't a ring, or no mineral signals remain, it returns `undefined` — the
 * recorder then writes nothing. No I/O here; the DB effect lives in the recorder.
 */

import type { CommodityId, SaaSignalsFoundEvent } from "@lodestar/shared";
import { commodityFromInternal } from "@lodestar/shared";

const SAA_SIGNAL_PREFIX = "$SAA_SignalType_";
const RING_NAME = /^(.+) [A-Z] Ring$/;

/** Ring names are "<body> <letter> Ring"; return the parent body, or undefined if not a ring. */
export function ringBodyName(ringName: string): string | undefined {
  return RING_NAME.exec(ringName)?.[1];
}

/**
 * Map an SAA signal type ("$SAA_SignalType_Painite;") to a canonical commodity id, or
 * `undefined` for a non-mineral signal (biological/geological/…) that isn't mineable.
 */
export function commodityFromSaaSignal(type: string): CommodityId | undefined {
  const inner = type.startsWith(SAA_SIGNAL_PREFIX)
    ? type.slice(SAA_SIGNAL_PREFIX.length).replace(/;$/, "")
    : type;
  const lookup = commodityFromInternal(inner);
  return lookup.ok ? lookup.commodity.id : undefined;
}

export interface SeenHotspot {
  readonly commodityId: CommodityId;
  readonly count: number;
}

export interface RingHotspots {
  readonly ringName: string;
  readonly bodyName: string;
  readonly hotspots: readonly SeenHotspot[];
}

/**
 * Interpret an SAASignalsFound event as ring hotspots. Returns `undefined` when the
 * body is not a ring or carries no mineral signals (both → record nothing).
 */
export function interpretSaaSignals(event: SaaSignalsFoundEvent): RingHotspots | undefined {
  const bodyName = ringBodyName(event.bodyName);
  if (bodyName === undefined) return undefined;
  const hotspots: SeenHotspot[] = [];
  for (const signal of event.signals) {
    const commodityId = commodityFromSaaSignal(signal.type);
    if (commodityId === undefined) continue; // non-mineral (biological/geological/…)
    hotspots.push({ commodityId, count: signal.count });
  }
  if (hotspots.length === 0) return undefined;
  return { ringName: event.bodyName, bodyName, hotspots };
}
