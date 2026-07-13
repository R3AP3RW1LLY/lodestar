/**
 * GPU enumeration via `nvidia-smi` (SSOT Step 0.8). Used by the Settings screen
 * so the operator can pick the AI GPU by UUID. Parsing is pure and tested;
 * running the binary is best-effort (no NVIDIA driver → empty list, never a
 * crash). This is local-only diagnostics — no network, no CUDA allocation.
 */

import { execFile } from "node:child_process";
import type { GpuInfo } from "@lodestar/shared";

export function parseNvidiaSmiCsv(csv: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  for (const line of lines) {
    const cols = line.split(",").map((c) => c.trim());
    if (cols.length < 4) continue;
    const index = Number(cols[0]);
    const memMatch = /(\d+)/.exec(cols[3] ?? "");
    if (!Number.isInteger(index) || memMatch === null) continue;
    gpus.push({
      index,
      uuid: cols[1] ?? "",
      name: cols[2] ?? "",
      memoryTotalMiB: Number(memMatch[1]),
    });
  }
  return gpus;
}

/** Result of invoking the GPU query tool: `error` true when the tool is absent or fails. */
export interface GpuQueryResult {
  readonly error: boolean;
  readonly stdout: string;
}

/** Injectable so the (best-effort, environment-dependent) tool call can be tested deterministically. */
export type GpuQuery = () => Promise<GpuQueryResult>;

const nvidiaSmiQuery: GpuQuery = () =>
  new Promise((resolve) => {
    execFile(
      "nvidia-smi",
      ["--query-gpu=index,uuid,name,memory.total", "--format=csv,noheader"],
      { timeout: 5000, windowsHide: true },
      (error, stdout) => {
        resolve({ error: error !== null, stdout });
      },
    );
  });

export async function listGpus(query: GpuQuery = nvidiaSmiQuery): Promise<GpuInfo[]> {
  const { error, stdout } = await query();
  return error ? [] : parseNvidiaSmiCsv(stdout);
}
