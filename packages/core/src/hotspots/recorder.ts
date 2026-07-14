/**
 * Hotspot recorder (SSOT Step 4.3). Lives in `core` because it does DB I/O (the pure
 * interpretation stays in `journal/events`). Folds the commander's OWN `Scan` and
 * `SAASignalsFound` events into the galaxy tables (`source='journal'`):
 *   - `Scan` → upsert body + rings with type + reserve (the only journal source of both),
 *   - `SAASignalsFound` → upsert the ring + its mineral hotspots, refreshing
 *     `last_confirmed` on a re-scan without duplicating (repository upserts).
 * Rings are linked to a system using the CURRENT location (name + coords), and only when
 * the event's `systemAddress` matches it — a scan is never misattributed to the wrong
 * system. Everything for one event is written in a single transaction.
 */

import type { Db } from "@lodestar/data";
import {
  createBodyRepository,
  createHotspotRepository,
  createRingRepository,
  createSystemRepository,
} from "@lodestar/data";
import type { Logger, ParsedJournalEvent } from "@lodestar/shared";
import { nullLogger } from "@lodestar/shared";
import { interpretRingScan } from "../journal/events/scan.js";
import { interpretSaaSignals } from "../journal/events/saa-signals.js";

/** The slice of the current location the recorder needs to place a scan (from RootState). */
export interface RecorderLocation {
  readonly system?: string;
  readonly systemAddress?: number;
  readonly starPos?: readonly [number, number, number];
}

export type SkipReason = "no-location" | "system-mismatch" | "no-rings" | "no-minerals";

export type RecordResult =
  | {
      readonly status: "recorded";
      readonly ringsTouched: number;
      readonly hotspotsRecorded: number;
    }
  | { readonly status: "skipped"; readonly reason: SkipReason }
  | { readonly status: "ignored" };

export interface HotspotRecorder {
  /** Record a Scan / SAASignalsFound into the galaxy tables; other events are ignored. */
  record: (event: ParsedJournalEvent, location: RecorderLocation) => RecordResult;
}

export function createHotspotRecorder(db: Db, logger: Logger = nullLogger): HotspotRecorder {
  const systems = createSystemRepository(db);
  const bodies = createBodyRepository(db);
  const rings = createRingRepository(db);
  const hotspots = createHotspotRepository(db);

  return {
    record: (event, location) => {
      if (event.event !== "Scan" && event.event !== "SAASignalsFound") {
        return { status: "ignored" };
      }
      const systemName = location.system;
      const starPos = location.starPos;
      const locAddr = location.systemAddress;
      if (systemName === undefined || starPos === undefined || locAddr === undefined) {
        logger.debug("hotspot.recorder.no-location", { event: event.event });
        return { status: "skipped", reason: "no-location" };
      }
      if (locAddr !== event.systemAddress) {
        logger.warn("hotspot.recorder.system-mismatch", {
          location: locAddr,
          event: event.systemAddress,
        });
        return { status: "skipped", reason: "system-mismatch" };
      }
      const at = event.timestamp;
      const [x, y, z] = starPos;
      const address = event.systemAddress;

      if (event.event === "Scan") {
        const scan = interpretRingScan(event);
        if (scan === undefined) return { status: "skipped", reason: "no-rings" };
        return db.transaction((): RecordResult => {
          const systemId = systems.upsert({ address, name: systemName, x, y, z }, at);
          const bodyId = bodies.upsert({ systemId, name: scan.bodyName }, at);
          for (const ring of scan.rings) {
            rings.upsert(
              {
                bodyId,
                name: ring.ringName,
                ringType: ring.ringType,
                reserve: ring.reserve ?? null,
              },
              at,
            );
          }
          return { status: "recorded", ringsTouched: scan.rings.length, hotspotsRecorded: 0 };
        })();
      }

      const interp = interpretSaaSignals(event);
      if (interp === undefined) return { status: "skipped", reason: "no-minerals" };
      return db.transaction((): RecordResult => {
        const systemId = systems.upsert({ address, name: systemName, x, y, z }, at);
        const bodyId = bodies.upsert({ systemId, name: interp.bodyName }, at);
        const ringId = rings.upsert({ bodyId, name: interp.ringName }, at);
        for (const hotspot of interp.hotspots) {
          hotspots.record(
            { ringId, commodityId: hotspot.commodityId, count: hotspot.count, source: "journal" },
            at,
          );
        }
        return { status: "recorded", ringsTouched: 1, hotspotsRecorded: interp.hotspots.length };
      })();
    },
  };
}
