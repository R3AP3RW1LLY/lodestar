import { describe, expect, it } from "vitest";
import { listGpus, parseNvidiaSmiCsv } from "./gpu.js";

describe("parseNvidiaSmiCsv", () => {
  it("parses the index,uuid,name,memory.total CSV output", () => {
    const csv = [
      "index, uuid, name, memory.total [MiB]",
      "0, GPU-2eba79a0-a13b, NVIDIA GeForce RTX 5070 Ti, 16303 MiB",
      "1, GPU-5612e762-42fc, NVIDIA GeForce RTX 3060, 12288 MiB",
    ].join("\n");
    expect(parseNvidiaSmiCsv(csv)).toEqual([
      {
        index: 0,
        uuid: "GPU-2eba79a0-a13b",
        name: "NVIDIA GeForce RTX 5070 Ti",
        memoryTotalMiB: 16303,
      },
      {
        index: 1,
        uuid: "GPU-5612e762-42fc",
        name: "NVIDIA GeForce RTX 3060",
        memoryTotalMiB: 12288,
      },
    ]);
  });

  it("returns an empty list for empty or header-only output", () => {
    expect(parseNvidiaSmiCsv("")).toEqual([]);
    expect(parseNvidiaSmiCsv("index, uuid, name, memory.total [MiB]")).toEqual([]);
  });

  it("skips malformed rows rather than throwing", () => {
    const csv =
      "index, uuid, name, memory.total\n0, GPU-x, Card, notanumber\n1, GPU-y, Good, 8192 MiB";
    expect(parseNvidiaSmiCsv(csv)).toEqual([
      { index: 1, uuid: "GPU-y", name: "Good", memoryTotalMiB: 8192 },
    ]);
  });
});

describe("listGpus", () => {
  it("parses the query tool's stdout when it succeeds", async () => {
    const gpus = await listGpus(() =>
      Promise.resolve({ error: false, stdout: "1, GPU-5612e762, RTX 3060, 12288 MiB" }),
    );
    expect(gpus).toEqual([
      { index: 1, uuid: "GPU-5612e762", name: "RTX 3060", memoryTotalMiB: 12288 },
    ]);
  });

  it("returns an empty list (never throws) when the query tool is absent or errors", async () => {
    expect(await listGpus(() => Promise.resolve({ error: true, stdout: "" }))).toEqual([]);
  });

  it("runs the real nvidia-smi query by default and resolves to an array either way", async () => {
    // No NVIDIA tool on CI → []; on the operator's box → real GPUs. Both are arrays.
    expect(Array.isArray(await listGpus())).toBe(true);
  });
});
