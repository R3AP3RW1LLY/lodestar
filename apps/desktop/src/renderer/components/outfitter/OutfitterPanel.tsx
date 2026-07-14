import { useEffect, useState } from "react";
import type { MiningMethod, OutfitterAdvice, OutfitterGap } from "@lodestar/shared";
import { MfdPanel } from "../MfdPanel.js";

const METHODS: { readonly id: MiningMethod; readonly label: string }[] = [
  { id: "laser", label: "Laser" },
  { id: "deep-core", label: "Deep Core" },
  { id: "subsurface", label: "Sub-surface" },
];

/**
 * The Outfitter — loadout advisor panel (SSOT Step 4.15b). Pick a mining method and see the
 * gap analysis against your last `Loadout`: what mining modules you have, which REQUIRED
 * ones are missing ("no Pulse Wave Analyser — required for deep-core"), and recommended
 * additions. Read-only — LODESTAR never changes your ship; it only tells you the gaps. It
 * pairs with the Vein Finder (what to mine ⇄ are you equipped for its method).
 */
export function OutfitterPanel(): React.JSX.Element {
  const [method, setMethod] = useState<MiningMethod>("laser");
  const [advice, setAdvice] = useState<OutfitterAdvice | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(() => window.lodestar.adviseOutfit(method))
      .then((a) => {
        if (!cancelled) setAdvice(a);
      })
      .catch(() => {
        if (!cancelled) setAdvice(null);
      });
    return () => {
      cancelled = true;
    };
  }, [method]);

  return (
    <MfdPanel title="Loadout Advisor">
      <div className="flex gap-1 p-2" role="group" aria-label="mining method">
        {METHODS.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => {
              setMethod(m.id);
            }}
            className={`clip-mfd border px-2 py-0.5 text-[10px] uppercase tracking-widest ${method === m.id ? "border-elite-orange text-elite-orange" : "border-cyan-dim/40 text-cyan-dim"}`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {advice === null || !advice.hasLoadout ? (
        <p className="p-2 text-sm text-signal-skip">
          No loadout captured yet — LODESTAR reads your ship on the next `Loadout` (switch ship or
          reload the game).
        </p>
      ) : (
        <div className="space-y-2 p-2 text-sm">
          <p className="text-cyan-dim">
            Ship <span className="text-white">{advice.ship}</span>
          </p>
          {advice.missingRequired.length > 0 && (
            <GapList title="Missing (required)" gaps={advice.missingRequired} tone="danger" />
          )}
          {advice.suggestions.length > 0 && (
            <GapList title="Recommended" gaps={advice.suggestions} tone="warn" />
          )}
          {advice.missingRequired.length === 0 && (
            <p className="text-signal-ok">✓ Equipped for {advice.method} mining.</p>
          )}
          {advice.present.length > 0 && (
            <p className="text-[11px] text-cyan-dim">
              Equipped: {advice.present.map((p) => p.label).join(", ")}
            </p>
          )}
        </div>
      )}
    </MfdPanel>
  );
}

function GapList({
  title,
  gaps,
  tone,
}: {
  readonly title: string;
  readonly gaps: readonly OutfitterGap[];
  readonly tone: "danger" | "warn";
}): React.JSX.Element {
  const color = tone === "danger" ? "text-signal-danger" : "text-signal-warn";
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-widest ${color}`}>{title}</p>
      <ul className="ml-1">
        {gaps.map((g) => (
          <li key={g.kind} className={color}>
            {g.label} <span className="text-cyan-dim">— {g.reason}</span>
            {!g.fitsShip && <span className="text-signal-danger"> (does not fit this ship)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
