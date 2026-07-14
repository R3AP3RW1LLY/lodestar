import type { ComponentType } from "react";
import { CommandDeck } from "./screens/CommandDeck.js";
import { Settings } from "./screens/Settings.js";
import { Assay } from "./screens/Assay.js";
import { Manifest } from "./screens/Manifest.js";
import { Ledger } from "./screens/Ledger.js";
import { Cartographer } from "./screens/Cartographer.js";
import { VeinFinder } from "./screens/VeinFinder.js";
import { moduleById } from "./modules.js";
import type { ModuleId } from "./modules.js";
import { MfdPanel } from "./components/MfdPanel.js";

/**
 * Registry of implemented module screens. Every module marked `available` in
 * modules.ts MUST have an entry here — a test cross-checks the two so they
 * cannot drift (an available module with no screen would otherwise silently
 * fall through to the "arrives in Phase N" notice).
 */
export const MODULE_SCREENS: Partial<Record<ModuleId, ComponentType>> = {
  "command-deck": CommandDeck,
  assay: Assay,
  manifest: Manifest,
  ledger: Ledger,
  cartographer: Cartographer,
  "vein-finder": VeinFinder,
  settings: Settings,
};

/** Renders the active module's screen, or an "arrives in Phase N" notice. */
export function ModuleView({ active }: { active: ModuleId }): React.JSX.Element {
  const Screen = MODULE_SCREENS[active];
  if (Screen !== undefined) return <Screen />;
  const module = moduleById(active);
  return (
    <div className="p-4">
      <MfdPanel title={module.label}>
        <p className="text-sm text-cyan">
          This module arrives in <span className="text-orange">Phase {module.phase}</span>.
        </p>
      </MfdPanel>
    </div>
  );
}
