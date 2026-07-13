import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { DataAgeBadge } from "../components/DataAgeBadge.js";
import { MfdPanel } from "../components/MfdPanel.js";
import { ShipPanel } from "../components/ShipPanel.js";
import { LocationPanel } from "../components/LocationPanel.js";
import { FuelPips } from "../components/FuelPips.js";
import { CargoPanel } from "../components/CargoPanel.js";
import { ActivityPanel } from "../components/ActivityPanel.js";
import { SessionStatsPanel } from "../components/SessionStatsPanel.js";
import { useGameState, subscribeGameState } from "../stores/game-state.js";
import { useNow } from "../hooks/use-now.js";
import { deriveDeckStatus } from "./deck-status.js";
import type { DeckStatus } from "./deck-status.js";

/**
 * The Command Deck comes alive (Step 1.10). Wires the renderer store to the live
 * telemetry bridge and renders ship / location / fuel+pips / cargo / activity /
 * session. Offline + not-configured are first-class: a valid journal with no
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
      <div className="flex flex-col gap-4 p-4" data-testid="deck-not-configured">
        <h1 className="font-display text-lg uppercase tracking-[0.3em] text-orange">
          Command Deck
        </h1>
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
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="font-display text-lg uppercase tracking-[0.3em] text-orange">
          Command Deck
        </h1>
        <DeckStatusBadge status={status} now={now} />
      </header>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <PanelSlot index={0}>
          <ShipPanel ship={state.ship} />
        </PanelSlot>
        <PanelSlot index={1}>
          <LocationPanel location={state.location} />
        </PanelSlot>
        <PanelSlot index={2}>
          <FuelPips ship={state.ship} pips={state.pips} />
        </PanelSlot>
        <PanelSlot index={3}>
          <CargoPanel cargo={state.cargo} />
        </PanelSlot>
        <PanelSlot index={4}>
          <ActivityPanel activity={state.activity} flags={state.flags} />
        </PanelSlot>
        <PanelSlot index={5}>
          <SessionStatsPanel session={session} />
        </PanelSlot>
      </div>
    </div>
  );
}

/** A subtle staggered fade-in for each panel (Framer Motion micro-transition). */
function PanelSlot({ index, children }: { index: number; children: ReactNode }): React.JSX.Element {
  return (
    <motion.div
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
    <span data-testid="deck-status" data-mode="online">
      {/* status.timestamp is guaranteed defined + fresh by deriveDeckStatus */}
      <DataAgeBadge timestamp={status.timestamp} source="journal" now={now} />
    </span>
  );
}
