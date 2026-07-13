/**
 * Command Deck connection state (Step 1.10). Pure + clock-injectable so the
 * offline/not-configured logic is exhaustively testable. Staleness is the whole
 * point: a valid journal with no fresh writes is GAME OFFLINE (last-known data,
 * clearly stamped) — never stale numbers presented as live.
 */

export type DeckMode = "not-configured" | "offline" | "online";

/**
 * The derived deck status. Discriminated on `mode` so the ONLINE case is the only
 * one that carries a guaranteed-fresh `timestamp` — the type makes it impossible
 * to render a LIVE badge from a fabricated/absent time (the SSOT's "never present
 * stale data as live" rule, enforced at compile time).
 */
export type DeckStatus =
  | { readonly mode: "not-configured" }
  | { readonly mode: "offline"; readonly timestamp?: string }
  | { readonly mode: "online"; readonly timestamp: string };

/** No journal writes within this window ⇒ the game is treated as offline. */
export const ONLINE_WINDOW_MS = 10_000;

export interface DeckStatusInput {
  /** undefined = settings not yet read; false = no journal path set. */
  readonly journalConfigured: boolean | undefined;
  /** ISO timestamp of the most recent folded event, if any. */
  readonly timestamp: string | undefined;
  readonly nowMs: number;
  readonly onlineWindowMs?: number;
}

export function deriveDeckStatus(input: DeckStatusInput): DeckStatus {
  // "Not configured" is only for a genuinely fresh setup — no journal path AND no
  // data has ever arrived. Once telemetry flows (a timestamp exists), show the
  // deck even if settings has no path yet (e.g. the LODESTAR_JOURNAL_DIR override).
  if (input.timestamp === undefined) {
    return input.journalConfigured === false ? { mode: "not-configured" } : { mode: "offline" };
  }
  const ts = Date.parse(input.timestamp);
  if (Number.isNaN(ts)) return { mode: "offline", timestamp: input.timestamp };
  const window = input.onlineWindowMs ?? ONLINE_WINDOW_MS;
  return input.nowMs - ts < window
    ? { mode: "online", timestamp: input.timestamp }
    : { mode: "offline", timestamp: input.timestamp };
}
