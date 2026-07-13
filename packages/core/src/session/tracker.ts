/**
 * Mining-session tracker (SSOT Step 1.8) — a PURE state machine folding
 * `StateInput`s into session lifecycle + rolling totals. Rules:
 *  - STARTS on the first mining signal (LaunchDrone prospector/collection or
 *    MiningRefined) while at a ring.
 *  - a relog (LoadGame) within 20 min of the last mining activity, same body,
 *    CONTINUES the active session (miners relog to reset asteroids).
 *  - ENDS when the session commodities' cargo reaches zero via sells, or after
 *    20 min with no mining activity, or on an explicit stop.
 *  - a MarketSell at a Fleet Carrier is treated as BANKING, not income —
 *    excluded from credits. Phase-1 approximation: this keys on
 *    `StationType === "FleetCarrier"`, so it also excludes sells at OTHER
 *    commanders' carriers (which ARE income); true own-carrier matching by
 *    carrier ID lands in Phase 8.
 * The tracker is pure and deterministic; persistence is the repository's job.
 */

import type { ParsedJournalEvent, SessionSummary, StateInput } from "@lodestar/shared";

const IDLE_TIMEOUT_MS = 20 * 60 * 1000;

export interface Refinement {
  readonly timestamp: string;
  readonly commodity: string;
  readonly tons: number;
}

export interface LoggedEvent {
  readonly timestamp: string;
  readonly eventType: string;
  readonly payload: string;
}

export interface Session {
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly lastActivityAt: string;
  readonly cmdr?: string;
  readonly ship?: string;
  readonly system?: string;
  readonly body?: string;
  readonly ring?: string;
  readonly tonsRefined: number;
  readonly creditsEarned: number;
  readonly bankedToCarrier: number;
  readonly limpetsLaunched: number;
  readonly commodities: readonly string[];
  readonly cargoByCommodity: Readonly<Record<string, number>>;
  readonly soldSomething: boolean;
  readonly refinements: readonly Refinement[];
  readonly events: readonly LoggedEvent[];
}

interface Context {
  // Internal working type — fields are cleared to undefined on FSDJump, so the
  // optionals must explicitly admit undefined (not just absence).
  readonly cmdr?: string | undefined;
  readonly ship?: string | undefined;
  readonly system?: string | undefined;
  readonly body?: string | undefined;
  readonly ring?: string | undefined;
  readonly stationType?: string | undefined;
  readonly docked: boolean;
}

export interface TrackerState {
  readonly active: Session | undefined;
  readonly context: Context;
  /** Sessions that ended on THIS input (drained by the caller for persistence). */
  readonly justEnded: readonly Session[];
}

export function initialTracker(): TrackerState {
  return { active: undefined, context: { docked: false }, justEnded: [] };
}

/** "$painite_name;" / "Painite" → "painite". */
export function normalizeCommodity(raw: string): string {
  return raw
    .replace(/^\$/, "")
    .replace(/_name;$/i, "")
    .toLowerCase();
}

const isRing = (name: string | undefined): boolean => name !== undefined && /\bRing$/.test(name);

function updateContext(ctx: Context, input: StateInput): Context {
  if (input.kind !== "journal") return ctx;
  const e = input.event;
  switch (e.event) {
    case "LoadGame":
      return { ...ctx, cmdr: e.commander, ship: e.ship };
    case "FSDJump":
      return { ...ctx, system: e.starSystem, docked: false, ring: undefined, body: undefined };
    case "Location":
      return {
        ...ctx,
        system: e.starSystem,
        docked: e.docked,
        body: e.body,
        ring: isRing(e.body) ? e.body : ctx.ring,
      };
    case "SupercruiseExit":
      return {
        ...ctx,
        system: e.starSystem,
        body: e.body,
        ring: isRing(e.body) ? e.body : ctx.ring,
      };
    case "SupercruiseEntry":
      // Entering supercruise means we've left the current ring behind — clear it
      // so a later mining signal isn't attributed to a ring we're no longer in.
      return { ...ctx, system: e.starSystem, ring: undefined };
    case "SAASignalsFound":
      return isRing(e.bodyName) ? { ...ctx, ring: e.bodyName } : ctx;
    case "Docked":
      // Docking likewise means we've left any ring.
      return {
        ...ctx,
        docked: true,
        stationType: e.stationType,
        system: e.starSystem,
        ring: undefined,
      };
    case "Undocked":
      // Leave stationType stale — it is only read while docked, where the next
      // Docked has already overwritten it; clearing it would need an undefined
      // assignment that exactOptionalPropertyTypes forbids.
      return { ...ctx, docked: false };
    default:
      return ctx;
  }
}

function isMiningStart(e: ParsedJournalEvent): boolean {
  if (e.event === "MiningRefined") return true;
  return (
    e.event === "LaunchDrone" && (e.droneType === "Prospector" || e.droneType === "Collection")
  );
}

function startSession(ctx: Context, timestamp: string): Session {
  return {
    startedAt: timestamp,
    lastActivityAt: timestamp,
    ...(ctx.cmdr !== undefined ? { cmdr: ctx.cmdr } : {}),
    ...(ctx.ship !== undefined ? { ship: ctx.ship } : {}),
    ...(ctx.system !== undefined ? { system: ctx.system } : {}),
    ...(ctx.body !== undefined ? { body: ctx.body } : {}),
    ...(ctx.ring !== undefined ? { ring: ctx.ring } : {}),
    tonsRefined: 0,
    creditsEarned: 0,
    bankedToCarrier: 0,
    limpetsLaunched: 0,
    commodities: [],
    cargoByCommodity: {},
    soldSomething: false,
    refinements: [],
    events: [],
  };
}

function logEvent(
  s: Session,
  e: ParsedJournalEvent,
  payload: Record<string, unknown>,
): LoggedEvent[] {
  return [
    ...s.events,
    { timestamp: e.timestamp, eventType: e.event, payload: JSON.stringify(payload) },
  ];
}

function applyJournal(s: Session, e: ParsedJournalEvent, ctx: Context): Session {
  switch (e.event) {
    case "MiningRefined": {
      const commodity = normalizeCommodity(e.type);
      return {
        ...s,
        tonsRefined: s.tonsRefined + 1,
        lastActivityAt: e.timestamp,
        commodities: s.commodities.includes(commodity)
          ? s.commodities
          : [...s.commodities, commodity],
        refinements: [...s.refinements, { timestamp: e.timestamp, commodity, tons: 1 }],
        events: logEvent(s, e, { type: commodity }),
      };
    }
    case "LaunchDrone":
      return {
        ...s,
        limpetsLaunched: s.limpetsLaunched + 1,
        lastActivityAt: e.timestamp,
        events: logEvent(s, e, { droneType: e.droneType }),
      };
    case "ProspectedAsteroid":
    case "AsteroidCracked":
      return { ...s, lastActivityAt: e.timestamp, events: logEvent(s, e, {}) };
    case "Cargo": {
      if (e.inventory === undefined) return s;
      const cargoByCommodity = { ...s.cargoByCommodity };
      for (const c of s.commodities) {
        cargoByCommodity[c] = e.inventory.find((i) => normalizeCommodity(i.name) === c)?.count ?? 0;
      }
      return { ...s, cargoByCommodity };
    }
    case "MarketSell": {
      const commodity = normalizeCommodity(e.type);
      if (!s.commodities.includes(commodity)) return s;
      // Phase-1 approximation: keys on station type, so this also banks sells at
      // OTHER commanders' carriers (really income) — own-carrier ID match is Phase 8.
      const carrier = ctx.stationType === "FleetCarrier";
      // Only adjust the running cargo estimate when a Cargo event has already
      // reported this commodity. Fabricating a count from an absent key would let
      // the first sell clamp to 0 and end the session with a full hold, so instead
      // end-detection waits for authoritative Cargo data (see sessionCargoZero).
      const prior = s.cargoByCommodity[commodity];
      const cargoByCommodity =
        prior === undefined
          ? s.cargoByCommodity
          : { ...s.cargoByCommodity, [commodity]: Math.max(0, prior - e.count) };
      return {
        ...s,
        creditsEarned: carrier ? s.creditsEarned : s.creditsEarned + e.totalSale,
        bankedToCarrier: carrier ? s.bankedToCarrier + e.totalSale : s.bankedToCarrier,
        soldSomething: true,
        cargoByCommodity,
        events: logEvent(s, e, {
          type: commodity,
          count: e.count,
          totalSale: e.totalSale,
          carrier,
        }),
      };
    }
    default:
      return s;
  }
}

function sessionCargoZero(s: Session): boolean {
  // A commodity is "drained" only once a Cargo event has explicitly reported it
  // at zero. An ABSENT key means "not yet observed" — never treat it as zero, or
  // a sell before the first Cargo snapshot would end the session prematurely.
  return (
    s.soldSomething &&
    s.commodities.length > 0 &&
    s.commodities.every((c) => s.cargoByCommodity[c] === 0)
  );
}

function inputTimestamp(input: StateInput): string {
  if (input.kind === "journal") return input.event.timestamp;
  if (input.kind === "status") return input.status.timestamp;
  return input.cargo.timestamp;
}

function end(s: Session, endedAt: string): Session {
  return { ...s, endedAt };
}

export function advance(state: TrackerState, input: StateInput): TrackerState {
  const context = updateContext(state.context, input);
  let active = state.active;
  const justEnded: Session[] = [];
  const ts = inputTimestamp(input);

  // Idle timeout: ≥20 min since the last mining activity ends the session.
  if (
    active !== undefined &&
    Date.parse(ts) - Date.parse(active.lastActivityAt) > IDLE_TIMEOUT_MS
  ) {
    justEnded.push(end(active, active.lastActivityAt));
    active = undefined;
  }

  if (input.kind === "journal") {
    const e = input.event;
    const miningAtRing = isMiningStart(e) && context.ring !== undefined;
    if (miningAtRing && active === undefined) {
      active = startSession(context, e.timestamp);
    } else if (miningAtRing && active !== undefined && context.ring !== active.ring) {
      // Mining resumed at a DIFFERENT ring (flew or relogged elsewhere) → close the
      // old session at its last activity and open a fresh one. A same-body relog
      // hits neither branch and simply continues the active session below.
      justEnded.push(end(active, active.lastActivityAt));
      active = startSession(context, e.timestamp);
    }
    if (active !== undefined) {
      active = applyJournal(active, e, context);
      if (sessionCargoZero(active)) {
        justEnded.push(end(active, e.timestamp));
        active = undefined;
      }
    }
  }

  return { active, context, justEnded };
}

/** Explicitly stop the active session (user pressed stop / app closing). */
export function stop(state: TrackerState, at: string): TrackerState {
  if (state.active === undefined) return { ...state, justEnded: [] };
  return { active: undefined, context: state.context, justEnded: [end(state.active, at)] };
}

/** Fold a whole input sequence, collecting every ended session + the final active one. */
export function foldSessions(inputs: Iterable<StateInput>): {
  ended: Session[];
  active: Session | undefined;
} {
  let state = initialTracker();
  const ended: Session[] = [];
  for (const input of inputs) {
    state = advance(state, input);
    ended.push(...state.justEnded);
  }
  return { ended, active: state.active };
}

export function summarize(s: Session, nowMs?: number): SessionSummary {
  const startMs = Date.parse(s.startedAt);
  const endMs =
    s.endedAt !== undefined ? Date.parse(s.endedAt) : (nowMs ?? Date.parse(s.lastActivityAt));
  const hours = Math.max(0, endMs - startMs) / 3_600_000;
  const rate = (n: number): number => (hours > 0 ? n / hours : 0);
  return {
    active: s.endedAt === undefined,
    startedAt: s.startedAt,
    ...(s.endedAt !== undefined ? { endedAt: s.endedAt } : {}),
    ...(s.cmdr !== undefined ? { cmdr: s.cmdr } : {}),
    ...(s.ship !== undefined ? { ship: s.ship } : {}),
    ...(s.system !== undefined ? { system: s.system } : {}),
    ...(s.body !== undefined ? { body: s.body } : {}),
    ...(s.ring !== undefined ? { ring: s.ring } : {}),
    tonsRefined: s.tonsRefined,
    tonsPerHour: rate(s.tonsRefined),
    creditsEarned: s.creditsEarned,
    creditsPerHour: rate(s.creditsEarned),
    limpetsLaunched: s.limpetsLaunched,
    bankedToCarrier: s.bankedToCarrier,
  };
}
