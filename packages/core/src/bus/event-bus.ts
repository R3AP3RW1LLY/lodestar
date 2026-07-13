/**
 * In-process typed pub/sub bus (SSOT Step 1.4). Keyed by a closed event map so
 * every publish/subscribe is fully typed. Guarantees:
 *  - ORDERED, SYNCHRONOUS dispatch: subscribers run in subscription order and all
 *    have run before `publish` returns.
 *  - PER-SUBSCRIBER ERROR ISOLATION: a throwing subscriber is logged and detached
 *    (so it can't keep failing); every other subscriber still runs.
 *  - STABLE dispatch: a subscriber added or removed DURING a dispatch does not
 *    disturb the in-flight event (each publish iterates a snapshot).
 *  - RE-ENTRANT SAFE: a subscriber that publishes another event is queued and
 *    drained FIFO after the current event finishes — global order is preserved and
 *    a cascade (line → domain event → state delta) can't recurse unbounded.
 *  - REPLAY-LAST channels: a new subscriber to a declared replay type immediately
 *    receives the last published value (state-snapshot semantics).
 *
 * Subscribing the same function twice to one type collapses to a single
 * subscription (Set semantics, like addEventListener).
 */

export interface BusLogger {
  warn(msg: string, fields?: Record<string, unknown>): void;
}

export type Listener<T> = (payload: T) => void;

export interface Subscription {
  unsubscribe(): void;
}

export interface EventBusOptions<Events> {
  /** Types whose last published value is replayed to every new subscriber. */
  readonly replayTypes?: readonly (keyof Events)[];
  readonly logger?: BusLogger;
}

export class EventBus<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<Listener<never>>>();
  private readonly lastValue = new Map<keyof Events, unknown>();
  private readonly replay: ReadonlySet<keyof Events>;
  private readonly logger: BusLogger | undefined;
  private readonly queue: { type: keyof Events; payload: unknown }[] = [];
  private draining = false;

  constructor(opts: EventBusOptions<Events> = {}) {
    this.replay = new Set(opts.replayTypes ?? []);
    this.logger = opts.logger;
  }

  subscribe<K extends keyof Events>(type: K, listener: Listener<Events[K]>): Subscription {
    // Listener<Events[K]> is assignable to Listener<never> (params are
    // contravariant), so heterogeneous listeners share one Set safely.
    const set = this.listeners.get(type) ?? new Set<Listener<never>>();
    set.add(listener);
    this.listeners.set(type, set);
    // Replay the last value to a new subscriber of a replay channel.
    if (this.replay.has(type) && this.lastValue.has(type)) {
      this.deliver(type, listener, this.lastValue.get(type) as never);
    }
    return {
      unsubscribe: () => {
        set.delete(listener);
      },
    };
  }

  publish<K extends keyof Events>(type: K, payload: Events[K]): void {
    if (this.replay.has(type)) this.lastValue.set(type, payload);
    this.queue.push({ type, payload });
    if (this.draining) return; // re-entrant publish: the active drain will process it
    this.draining = true;
    try {
      let next = this.queue.shift();
      while (next !== undefined) {
        this.dispatch(next.type, next.payload);
        next = this.queue.shift();
      }
    } finally {
      this.draining = false;
    }
  }

  private dispatch(type: keyof Events, payload: unknown): void {
    const set = this.listeners.get(type);
    if (set === undefined) return;
    // Snapshot so add/remove during dispatch can't disturb the in-flight event;
    // re-check membership so a mid-dispatch unsubscribe is still honored.
    for (const listener of [...set]) {
      if (!set.has(listener)) continue;
      this.deliver(type, listener, payload as never);
    }
  }

  private deliver(type: keyof Events, listener: Listener<never>, payload: never): void {
    try {
      listener(payload);
    } catch (error) {
      this.listeners.get(type)?.delete(listener); // detach the broken subscriber
      this.logger?.warn("bus.subscriber-threw", { type: String(type), error: String(error) });
    }
  }
}
