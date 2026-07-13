import { describe, expect, it } from "vitest";
import { createSpeechQueue, SPEECH_CLASS_ORDER } from "./speech-queue.js";
import type { Speaker, Utterance } from "./speech-queue.js";

/**
 * A speaker the test drives one utterance at a time: each `speak` records its text
 * and parks until the test calls `finish` (resolving or rejecting it), then flushes
 * the microtasks so the queue pumps the next utterance.
 */
function controllableSpeaker(): {
  speaker: Speaker;
  spoken: string[];
  finish: (mode?: "ok" | "fail") => Promise<void>;
} {
  const spoken: string[] = [];
  let ctl: { resolve: () => void; reject: (e: unknown) => void } | undefined;
  const speaker: Speaker = {
    speak(text) {
      spoken.push(text);
      return new Promise<void>((resolve, reject) => {
        ctl = { resolve, reject };
      });
    },
  };
  async function finish(mode: "ok" | "fail" = "ok"): Promise<void> {
    const c = ctl;
    ctl = undefined;
    if (mode === "fail") c?.reject(new Error("tts-fail"));
    else c?.resolve();
    await new Promise<void>((res) => setTimeout(res, 0)); // flush .finally + next pump
  }
  return { speaker, spoken, finish };
}

const u = (text: string, cls: Utterance["class"], key?: string): Utterance =>
  key === undefined ? { text, class: cls } : { text, class: cls, key };

describe("speech queue (priority classes)", () => {
  it("documents the priority order ops-echo > safety > alert > verdict > ambient", () => {
    expect(SPEECH_CLASS_ORDER).toEqual(["ops-echo", "safety", "alert", "verdict", "ambient"]);
  });

  it("speaks a single utterance and reports speaking/pending state", async () => {
    const s = controllableSpeaker();
    const q = createSpeechQueue({ speaker: s.speaker });
    q.enqueue(u("platinum thirty percent, mine", "verdict"));
    expect(s.spoken).toEqual(["platinum thirty percent, mine"]);
    expect(q.speaking()).toBe(true);
    expect(q.pending()).toBe(0);
    await s.finish();
    expect(q.speaking()).toBe(false);
  });

  it("preserves FIFO order within a class", async () => {
    const s = controllableSpeaker();
    const q = createSpeechQueue({ speaker: s.speaker });
    q.enqueue(u("a1", "ambient")); // starts speaking
    q.enqueue(u("a2", "ambient"));
    q.enqueue(u("a3", "ambient"));
    expect(q.pending()).toBe(2);
    await s.finish();
    await s.finish();
    await s.finish();
    expect(s.spoken).toEqual(["a1", "a2", "a3"]);
  });

  it("a higher class preempts lower-class backlog across ALL five classes", async () => {
    const s = controllableSpeaker();
    const q = createSpeechQueue({ speaker: s.speaker });
    q.enqueue(u("amb", "ambient")); // occupies the speaker
    // Enqueue lowest→highest; each must jump ahead of the lower-class backlog.
    q.enqueue(u("v", "verdict"));
    q.enqueue(u("al", "alert"));
    q.enqueue(u("sf", "safety"));
    q.enqueue(u("oe", "ops-echo"));
    for (let i = 0; i < 4; i += 1) await s.finish();
    expect(s.spoken).toEqual(["amb", "oe", "sf", "al", "v"]);
  });

  it("dedupes an identical utterance that is still pending or playing", async () => {
    const s = controllableSpeaker();
    const q = createSpeechQueue({ speaker: s.speaker });
    q.enqueue(u("hold", "alert")); // occupies the speaker
    q.enqueue(u("boom", "alert"));
    q.enqueue(u("boom", "alert")); // duplicate of the pending one → dropped
    expect(q.pending()).toBe(1);
    // Dedupe also covers the currently-playing utterance.
    q.enqueue(u("hold", "alert"));
    expect(q.pending()).toBe(1);
    await s.finish(); // hold → boom
    await s.finish(); // boom done
    expect(s.spoken).toEqual(["hold", "boom"]);
  });

  it("cancels a superseded verdict before it is ever spoken", async () => {
    const s = controllableSpeaker();
    const q = createSpeechQueue({ speaker: s.speaker });
    q.enqueue(u("hold", "alert")); // occupies the speaker
    q.enqueue(u("v1: painite, mine", "verdict"));
    q.enqueue(u("v2: platinum, skip", "verdict")); // supersedes v1 (new rock)
    expect(q.pending()).toBe(1);
    await s.finish(); // hold → v2
    await s.finish();
    expect(s.spoken).toEqual(["hold", "v2: platinum, skip"]);
    expect(s.spoken).not.toContain("v1: painite, mine");
  });

  it("non-supersede classes keep distinct keys (only exact dupes drop)", () => {
    const s = controllableSpeaker();
    const q = createSpeechQueue({ speaker: s.speaker });
    q.enqueue(u("occupy", "alert"));
    q.enqueue(u("proximity", "alert", "k1"));
    q.enqueue(u("heat", "alert", "k2")); // different key → both kept
    q.enqueue(u("proximity again", "alert", "k1")); // same key k1 → deduped
    expect(q.pending()).toBe(2);
  });

  it("clear() drops pending utterances but not the one already playing", async () => {
    const s = controllableSpeaker();
    const q = createSpeechQueue({ speaker: s.speaker });
    q.enqueue(u("a", "ambient")); // playing
    q.enqueue(u("b", "ambient"));
    q.enqueue(u("c", "ambient"));
    expect(q.pending()).toBe(2);
    q.clear();
    expect(q.pending()).toBe(0);
    expect(q.speaking()).toBe(true);
    await s.finish();
    expect(s.spoken).toEqual(["a"]); // b, c were cleared before they could play
  });

  it("continues after a speaker error (reports it, then plays the next)", async () => {
    const s = controllableSpeaker();
    const errors: string[] = [];
    const q = createSpeechQueue({
      speaker: s.speaker,
      onError: (utterance) => errors.push(utterance.text),
    });
    q.enqueue(u("bad", "alert")); // will reject
    q.enqueue(u("good", "alert"));
    await s.finish("fail"); // bad rejects → onError, then pump → good
    expect(errors).toEqual(["bad"]);
    expect(s.spoken).toEqual(["bad", "good"]);
    await s.finish();
    expect(q.speaking()).toBe(false);
  });

  it("survives a speaker that throws SYNCHRONOUSLY (never wedges the pump)", async () => {
    const spoken: string[] = [];
    const errors: string[] = [];
    let explode = true;
    const speaker: Speaker = {
      speak(text) {
        if (explode) {
          explode = false;
          throw new Error("sync boom"); // e.g. EPIPE writing to a dead Piper pipe
        }
        spoken.push(text);
        return Promise.resolve();
      },
    };
    const q = createSpeechQueue({ speaker, onError: (utterance) => errors.push(utterance.text) });
    q.enqueue(u("explode", "alert")); // must NOT throw out of enqueue
    q.enqueue(u("recovered", "alert"));
    await new Promise((r) => setTimeout(r, 0));
    expect(errors).toEqual(["explode"]);
    expect(spoken).toEqual(["recovered"]); // the pump recovered and played the next
    expect(q.speaking()).toBe(false);
  });
});
