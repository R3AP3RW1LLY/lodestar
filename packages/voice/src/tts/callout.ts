/**
 * Verdict → spoken callout (SSOT Step 2.7b). Turns an Assay verdict into a short,
 * TTS-friendly line ("Painite, thirty percent. Mine."). Pure + structural (takes
 * only the fields it needs, so `voice` need not import the verdict type) — the
 * reasons are already ordered dominant-first by the verdict engine (2.4), so the
 * first motherlode/proportion reason is the one to speak.
 */

export interface CalloutReason {
  readonly code: string;
  readonly display?: string;
  readonly proportion?: number;
}

export interface CalloutInput {
  readonly call: "MINE" | "SKIP";
  readonly reasons: readonly CalloutReason[];
}

/** A short spoken line for a verdict; empty string if there's nothing worth saying. */
export function formatCallout(verdict: CalloutInput): string {
  if (verdict.call === "SKIP") return "Skip.";

  const motherlode = verdict.reasons.find((r) => r.code === "motherlode");
  if (motherlode?.display !== undefined) {
    return `${motherlode.display} motherlode. Mine.`;
  }
  const proportion = verdict.reasons.find(
    (r) => r.code === "proportion-above-threshold" && r.display !== undefined,
  );
  if (proportion?.display !== undefined && proportion.proportion !== undefined) {
    return `${proportion.display}, ${String(Math.round(proportion.proportion))} percent. Mine.`;
  }
  return "Mine.";
}
