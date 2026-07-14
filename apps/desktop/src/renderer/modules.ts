/**
 * The module registry driving the nav rail (SSOT Step 0.9). Each module is
 * either available now (renders its screen) or arrives in a later phase (renders
 * a real "arrives in Phase N" notice — never a dead link).
 */

export type ModuleId =
  | "command-deck"
  | "assay"
  | "manifest"
  | "vein-finder"
  | "ledger"
  | "cartographer"
  | "assistant"
  | "ops"
  | "carrier"
  | "wing"
  | "settings";

export interface ModuleDef {
  readonly id: ModuleId;
  readonly label: string;
  /** The phase that delivers this module (for the "arrives in Phase N" notice). */
  readonly phase: number;
  /** Whether the module is reachable now. */
  readonly available: boolean;
}

export const MODULES: readonly ModuleDef[] = [
  { id: "command-deck", label: "Command Deck", phase: 1, available: true },
  { id: "assay", label: "Assay", phase: 2, available: true },
  { id: "manifest", label: "Manifest", phase: 3, available: true },
  { id: "vein-finder", label: "Vein Finder", phase: 4, available: false },
  { id: "ledger", label: "Ledger", phase: 4, available: false },
  { id: "cartographer", label: "Cartographer", phase: 4, available: false },
  { id: "assistant", label: "Assistant", phase: 5, available: false },
  { id: "ops", label: "Ops", phase: 7, available: false },
  { id: "carrier", label: "Carrier", phase: 8, available: false },
  { id: "wing", label: "Wing", phase: 9, available: false },
  { id: "settings", label: "Settings", phase: 0, available: true },
];

export function moduleById(id: ModuleId): ModuleDef {
  const found = MODULES.find((m) => m.id === id);
  if (found === undefined) throw new Error(`unknown module: ${id}`);
  return found;
}
