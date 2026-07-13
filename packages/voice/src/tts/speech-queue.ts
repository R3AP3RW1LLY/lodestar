/**
 * Priority speech queue (SSOT Step 2.7). Utterances carry a named CLASS; the queue
 * plays them one at a time through an injected `Speaker` (the Piper client), in
 * strict class priority with FIFO within a class:
 *
 *   ops-echo > safety > alert > verdict > ambient
 *
 * A higher class preempts lower-class BACKLOG (it jumps ahead of queued lower-class
 * items — Phase 7's confirmation echo, `ops-echo`, depends on this). The currently-
 * playing utterance is short and always finishes (no mid-word barge-in). Identical
 * utterances of a NON-supersede class DEDUPE (never repeated while still pending or
 * playing), and a SUPERSEDE class — `verdict` by default — cancels its own un-spoken backlog
 * when a newer one arrives (you've moved to a new rock; only the latest verdict
 * matters). Pure logic + an injected async speaker → fully unit-testable.
 */

export type SpeechClass = "ops-echo" | "safety" | "alert" | "verdict" | "ambient";

/** Priority order, highest first. A lower index outranks (plays before) a higher one. */
export const SPEECH_CLASS_ORDER: readonly SpeechClass[] = [
  "ops-echo",
  "safety",
  "alert",
  "verdict",
  "ambient",
];

export interface Utterance {
  readonly text: string;
  readonly class: SpeechClass;
  /**
   * Dedupe/supersede key within a class (defaults to `text`). Two utterances with
   * the same (class, key) are the "same" line for dedupe; a supersede class treats
   * ANY newer same-class utterance as replacing its pending backlog.
   */
  readonly key?: string;
}

/** Plays one utterance to completion. The Piper client (2.7) implements this. */
export interface Speaker {
  speak(text: string): Promise<void>;
}

export interface SpeechQueueOptions {
  readonly speaker: Speaker;
  /**
   * Classes whose newer utterance CANCELS its own un-spoken backlog. `verdict` by
   * default — a new prospect's callout supersedes the previous rock's un-spoken one.
   */
  readonly supersede?: readonly SpeechClass[];
  /** Called if the speaker rejects; the queue then continues with the next utterance. */
  readonly onError?: (utterance: Utterance, error: unknown) => void;
}

export interface SpeechQueue {
  /** Enqueue an utterance (deduped/superseded per its class), then pump. */
  enqueue(utterance: Utterance): void;
  /** Count of not-yet-spoken utterances (excludes the one currently playing). */
  pending(): number;
  /** Whether an utterance is currently playing. */
  speaking(): boolean;
  /** Drop all pending utterances; does NOT interrupt the current one. */
  clear(): void;
}

export function createSpeechQueue(opts: SpeechQueueOptions): SpeechQueue {
  const supersede = new Set<SpeechClass>(opts.supersede ?? ["verdict"]);
  const rank = (c: SpeechClass): number => SPEECH_CLASS_ORDER.indexOf(c);
  const keyOf = (u: Utterance): string => u.key ?? u.text;

  const queue: Utterance[] = [];
  let active = false;
  let current: Utterance | undefined;

  function insertByPriority(u: Utterance): void {
    // Place AFTER every queued item of equal-or-higher priority (FIFO within class),
    // i.e. before the first strictly-lower-priority item.
    const r = rank(u.class);
    let i = 0;
    while (i < queue.length) {
      const item = queue[i];
      if (item === undefined || rank(item.class) > r) break;
      i += 1;
    }
    queue.splice(i, 0, u);
  }

  function afterPlay(): void {
    active = false;
    current = undefined;
    pump();
  }

  function pump(): void {
    if (active) return;
    const next = queue.shift();
    if (next === undefined) {
      current = undefined;
      return;
    }
    active = true;
    current = next;
    let playing: Promise<void>;
    try {
      playing = opts.speaker.speak(next.text);
    } catch (error) {
      // A SYNCHRONOUS throw (e.g. a dead-pipe EPIPE writing to the Piper child) is
      // funneled to the same recovery as a rejection — otherwise it would escape
      // `pump`, strand the utterance, and leave `active` stuck true, silencing all
      // speech forever. `afterPlay` re-pumps (bounded by the queue length).
      opts.onError?.(next, error);
      afterPlay();
      return;
    }
    void playing.then(afterPlay, (error: unknown) => {
      opts.onError?.(next, error);
      afterPlay();
    });
  }

  return {
    enqueue(u) {
      if (supersede.has(u.class)) {
        // Cancel this class's un-spoken backlog — only the latest matters.
        for (let i = queue.length - 1; i >= 0; i -= 1) {
          if (queue[i]?.class === u.class) queue.splice(i, 1);
        }
      } else {
        // Dedupe: skip if an identical (class, key) utterance is pending or playing.
        const key = keyOf(u);
        const isDup = (q: Utterance | undefined): boolean =>
          q !== undefined && q.class === u.class && keyOf(q) === key;
        if (isDup(current) || queue.some(isDup)) return;
      }
      insertByPriority(u);
      pump();
    },
    pending: () => queue.length,
    speaking: () => active,
    clear: () => {
      queue.length = 0;
    },
  };
}
