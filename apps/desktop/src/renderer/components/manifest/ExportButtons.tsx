import { useState } from "react";
import type { AnalyticsExportRequest } from "@lodestar/shared";

type ExportKind = AnalyticsExportRequest["kind"];

const KINDS: readonly { readonly kind: ExportKind; readonly label: string }[] = [
  { kind: "sessions", label: "Sessions" },
  { kind: "refinements", label: "Refinements" },
  { kind: "prospects", label: "Prospects" },
];

/** CSV export buttons (Step 3.6): each opens a native save dialog for its dataset. */
export function ExportButtons(): React.JSX.Element {
  const [note, setNote] = useState<string | null>(null);
  const onExport = (kind: ExportKind): void => {
    setNote(null);
    window.lodestar
      .exportAnalytics({ kind, bom: true })
      .then((r) => {
        setNote(r.ok ? "Exported ✓" : "Cancelled");
      })
      .catch(() => {
        setNote("Export failed");
      });
  };
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="export-buttons">
      <span className="text-[10px] uppercase tracking-[0.18em] text-cyan-dim">Export CSV</span>
      {KINDS.map((k) => (
        <button
          key={k.kind}
          type="button"
          data-testid={`export-${k.kind}`}
          onClick={() => {
            onExport(k.kind);
          }}
          className="clip-mfd border border-white/10 px-2.5 py-1 font-display text-[10px] uppercase tracking-[0.18em] text-cyan/80 transition-colors hover:border-cyan/40 hover:text-cyan"
        >
          {k.label}
        </button>
      ))}
      {note !== null && <span className="text-[10px] text-signal-ok">{note}</span>}
    </div>
  );
}
