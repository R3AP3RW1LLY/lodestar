/**
 * Mining-vs-other time split (SSOT Step 3.7) — PURE segmentation of a session's
 * duration from its mining-event cadence. The Phase-1 activity classifier's
 * per-moment flags aren't persisted, so we approximate: consecutive MINING events
 * (LaunchDrone / MiningRefined / ProspectedAsteroid / AsteroidCracked) no more than
 * `gapThresholdSec` apart bound "active mining" time; a larger gap (fly to a fresh
 * patch, sell run) is "other". `miningSec + otherSec == durationSec` (reconciled).
 */

const MINING_EVENTS = new Set([
  "LaunchDrone",
  "MiningRefined",
  "ProspectedAsteroid",
  "AsteroidCracked",
]);

const DEFAULT_GAP_THRESHOLD_SEC = 300; // 5 min

export interface TimeSplitEventInput {
  readonly eventType: string;
  readonly timestamp: string;
}

export interface SessionTimeSplit {
  readonly durationSec: number;
  readonly miningSec: number;
  readonly otherSec: number;
  /** Fraction of the session spent actively mining (0–1). */
  readonly miningRatio: number;
}

export function sessionTimeSplit(
  events: readonly TimeSplitEventInput[],
  startedAt: string,
  endedAt: string | null,
  gapThresholdSec: number = DEFAULT_GAP_THRESHOLD_SEC,
): SessionTimeSplit {
  const startMs = Date.parse(startedAt);
  const endMs = endedAt === null ? NaN : Date.parse(endedAt);
  const durationSec =
    Number.isFinite(startMs) && Number.isFinite(endMs)
      ? Math.max(0, Math.round((endMs - startMs) / 1000))
      : 0;

  const times = events
    .filter((e) => MINING_EVENTS.has(e.eventType))
    .map((e) => Date.parse(e.timestamp))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  let miningMs = 0;
  const thresholdMs = gapThresholdSec * 1000;
  for (let k = 1; k < times.length; k++) {
    const gap = (times[k] ?? 0) - (times[k - 1] ?? 0);
    if (gap > 0 && gap <= thresholdMs) miningMs += gap;
  }

  const miningSec = Math.min(durationSec, Math.round(miningMs / 1000));
  const otherSec = Math.max(0, durationSec - miningSec);
  return {
    durationSec,
    miningSec,
    otherSec,
    miningRatio: durationSec > 0 ? miningSec / durationSec : 0,
  };
}

export interface TimeSplitTotals {
  readonly sessions: number;
  readonly durationSec: number;
  readonly miningSec: number;
  readonly otherSec: number;
  readonly miningRatio: number;
}

export function aggregateTimeSplit(perSession: readonly SessionTimeSplit[]): TimeSplitTotals {
  let duration = 0;
  let mining = 0;
  for (const s of perSession) {
    duration += s.durationSec;
    mining += s.miningSec;
  }
  return {
    sessions: perSession.length,
    durationSec: duration,
    miningSec: mining,
    otherSec: duration - mining,
    miningRatio: duration > 0 ? mining / duration : 0,
  };
}
