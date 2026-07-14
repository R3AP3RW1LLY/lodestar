import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { DataAgeBadge } from "../components/DataAgeBadge.js";
import { MfdPanel } from "../components/MfdPanel.js";
import { ScreenHeader } from "../components/ScreenHeader.js";
import { SituationPanel } from "../components/SituationPanel.js";
import { CargoPanel } from "../components/CargoPanel.js";
import { SessionStatsPanel } from "../components/SessionStatsPanel.js";
import { FuelPips } from "../components/FuelPips.js";
import { VesselStrip } from "../components/VesselStrip.js";
import { useGameState, subscribeGameState } from "../stores/game-state.js";
import { useNow } from "../hooks/use-now.js";
import { deriveDeckStatus } from "./deck-status.js";
import type { DeckStatus } from "./deck-status.js";

/**
 * The Command Deck (redesigned). A purposeful bento rather than a grid of equal
 * tiles: the SITUATION (what + where) and CARGO fill lead as the hero row, the
 * SESSION rates and FUEL/POWER sit beneath, and static ship identity trails as a
 * slim VESSEL strip. One fuel readout, one clear hierarchy, glanceable at speed.
 *
 * Offline + not-configured stay first-class (Step 1.10): a valid journal with no
 * fresh writes shows GAME OFFLINE over the LAST-KNOWN snapshot (never stale data
 * dressed as live); no journal at all guides the commander to Settings.
 */
export function CommandDeck({ nowMs }: { readonly nowMs?: number } = {}): React.JSX.Element {
  const state = useGameState((s) => s.state);
  const session = useGameState((s) => s.session);
  const ticking = useNow(1000);
  const [journalConfigured, setJournalConfigured] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let off = (): void => {};
    // A missing/failed bridge must degrade gracefully (last-known panels), never
    // blank the screen — subscribeGameState touches window.lodestar synchronously.
    try {
      off = subscribeGameState(window.lodestar);
    } catch {
      /* bridge unavailable — the panels still render whatever the store holds */
    }
    let cancelled = false;
    window.lodestar
      .getSettings()
      .then((settings) => {
        if (!cancelled) setJournalConfigured(settings.journalPath !== null);
      })
      .catch(() => {
        /* settings read failed — leave undefined; the panels still render last-known */
      });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const now = nowMs ?? ticking;
  const status = deriveDeckStatus({ journalConfigured, timestamp: state.timestamp, nowMs: now });

  if (status.mode === "not-configured") {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-5 p-5" data-testid="deck-not-configured">
        <ScreenHeader title="Command Deck" />
        <MfdPanel title="No journal configured">
          <p className="text-sm text-cyan">
            LODESTAR needs your Elite Dangerous journal folder to show live telemetry.
          </p>
          <p className="mt-2 text-xs text-signal-skip">
            Open <span className="text-orange">Settings</span> to auto-detect or set the journal
            path.
          </p>
        </MfdPanel>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-5">
      <ScreenHeader title="Command Deck" trailing={<DeckStatusBadge status={status} now={now} />} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <PanelSlot index={0} className="lg:col-span-8">
          <SituationPanel activity={state.activity} location={state.location} flags={state.flags} />
        </PanelSlot>
        <PanelSlot index={1} className="lg:col-span-4">
          <CargoPanel cargo={state.cargo} capacity={state.ship.cargoCapacity} />
        </PanelSlot>
        <PanelSlot index={2} className="lg:col-span-8">
          <SessionStatsPanel session={session} />
        </PanelSlot>
        <PanelSlot index={3} className="lg:col-span-4">
          <FuelPips ship={state.ship} pips={state.pips} />
        </PanelSlot>
        <PanelSlot index={4} className="lg:col-span-12">
          <VesselStrip ship={state.ship} />
        </PanelSlot>
      </div>
    </div>
  );
}

/** A subtle staggered fade-in for each panel (Framer Motion micro-transition). */
function PanelSlot({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: index * 0.03 }}
    >
      {children}
    </motion.div>
  );
}

function DeckStatusBadge({
  status,
  now,
}: {
  status: Exclude<DeckStatus, { mode: "not-configured" }>;
  now: number;
}): React.JSX.Element {
  if (status.mode === "offline") {
    return (
      <span
        data-testid="deck-status"
        data-mode="offline"
        className="clip-mfd flex items-center gap-2 border border-signal-danger/70 px-2 py-0.5 font-display text-xs uppercase tracking-[0.2em] text-signal-danger"
      >
        Game Offline
        {status.timestamp !== undefined && (
          <DataAgeBadge timestamp={status.timestamp} source="journal" now={now} />
        )}
      </span>
    );
  }
  return (
    <span
      data-testid="deck-status"
      data-mode="online"
      className="flex items-center gap-2 font-display text-xs uppercase tracking-[0.2em] text-signal-ok"
    >
      <span className="h-2 w-2 rounded-full bg-signal-ok shadow-[0_0_10px_rgba(51,221,153,0.7)]" />
      Live
      {/* status.timestamp is guaranteed defined + fresh by deriveDeckStatus */}
      <DataAgeBadge timestamp={status.timestamp} source="journal" now={now} />
    </span>
  );
}
