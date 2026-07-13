import type { ReactNode } from "react";

export interface StatProps {
  readonly label: string;
  readonly value: ReactNode;
  readonly mono?: boolean;
}

/** A labelled value row — the MFD's atomic readout (Step 1.10). */
export function Stat({ label, value, mono }: StatProps): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[10px] uppercase tracking-wider text-cyan-dim">{label}</span>
      <span className={`text-sm text-orange ${mono === true ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
