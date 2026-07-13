import { describe, expect, it, vi } from "vitest";
import { base64ToBytes, createTtsPlayer } from "./tts-player.js";

interface FakeCtx {
  ctx: AudioContext;
  started: () => number;
  gainValue: () => number;
  closed: () => boolean;
}

/** A minimal Web Audio stand-in (cast to AudioContext — jsdom has no real one). */
function fakeContext(): FakeCtx {
  let started = 0;
  let closed = false;
  const gain = { gain: { value: 1 }, connect: () => undefined };
  const source = {
    buffer: null as unknown,
    connect: () => undefined,
    start: () => {
      started += 1;
    },
  };
  const ctx = {
    decodeAudioData: () => Promise.resolve({ duration: 1 }),
    createBufferSource: () => source,
    createGain: () => gain,
    destination: {},
    close: () => {
      closed = true;
      return Promise.resolve();
    },
  } as unknown as AudioContext;
  return { ctx, started: () => started, gainValue: () => gain.gain.value, closed: () => closed };
}

describe("tts-player", () => {
  it("base64ToBytes round-trips WAV magic", () => {
    expect(Array.from(base64ToBytes(btoa("RIFF")))).toEqual([0x52, 0x49, 0x46, 0x46]);
  });

  it("decodes, sets clamped gain, and starts playback", async () => {
    const fake = fakeContext();
    const player = createTtsPlayer(() => fake.ctx);
    await player.play({ wavBase64: btoa("RIFF0000WAVE"), volume: 1.5 });
    expect(fake.started()).toBe(1);
    expect(fake.gainValue()).toBe(1); // clamped from 1.5 → 1
  });

  it("clamps a negative volume to 0", async () => {
    const fake = fakeContext();
    const player = createTtsPlayer(() => fake.ctx);
    await player.play({ wavBase64: btoa("RIFF"), volume: -3 });
    expect(fake.gainValue()).toBe(0);
  });

  it("reuses one AudioContext across plays and closes it on dispose", async () => {
    const fake = fakeContext();
    const make = vi.fn(() => fake.ctx);
    const player = createTtsPlayer(make);
    await player.play({ wavBase64: btoa("RIFF"), volume: 0.5 });
    await player.play({ wavBase64: btoa("RIFF"), volume: 0.5 });
    expect(make).toHaveBeenCalledTimes(1); // one context reused
    player.dispose();
    expect(fake.closed()).toBe(true);
  });
});
