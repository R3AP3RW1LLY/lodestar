/**
 * IPC channel contracts (SSOT §5.6). The Channel union is CLOSED — it grows
 * only when a phase's step adds a channel here together with its payload type.
 * Phase 0 defines: app.health.
 *
 * CHANNEL_SET is validated in BOTH directions at compile time: a payload type
 * without a CHANNEL_SET entry and a CHANNEL_SET entry without a payload type
 * are each compile errors.
 */

export interface AppHealth {
  readonly version: string;
  readonly dbStatus: "not-configured" | "ok" | "error";
  readonly journalStatus: "not-configured" | "ok" | "error";
}

export interface ChannelPayloads {
  readonly "app.health": AppHealth;
}

const CHANNEL_SET = {
  "app.health": true,
} as const satisfies Record<keyof ChannelPayloads, true>;

export type Channel = keyof ChannelPayloads;

export const CHANNELS = Object.keys(CHANNEL_SET) as readonly Channel[];

/**
 * Envelope is a distributive discriminated union: narrowing on `.channel`
 * narrows `.payload` for every consumer, not just the constructor call site.
 */
export type Envelope<C extends Channel = Channel> = {
  [K in Channel]: {
    readonly v: 1;
    readonly ts: string;
    readonly channel: K;
    readonly payload: ChannelPayloads[K];
  };
}[C];

/**
 * What isEnvelope actually verifies: outer shape only. The payload is
 * UNVALIDATED (`unknown`) — per-channel payload validation happens at each
 * channel's consumer (added with the channel's owning step).
 */
export interface EnvelopeShape {
  readonly v: 1;
  readonly ts: string;
  readonly channel: Channel;
  readonly payload: unknown;
}

export function envelope<C extends Channel>(
  channel: C,
  payload: ChannelPayloads[C],
  now: () => Date = () => new Date(),
): Envelope<C> {
  return { v: 1, ts: now().toISOString(), channel, payload } as Envelope<C>;
}

export function isEnvelope(value: unknown): value is EnvelopeShape {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record["v"] === 1 &&
    typeof record["ts"] === "string" &&
    typeof record["channel"] === "string" &&
    (CHANNELS as readonly string[]).includes(record["channel"]) &&
    Object.hasOwn(record, "payload")
  );
}
