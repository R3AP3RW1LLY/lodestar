/**
 * Lightweight cross-screen navigation (SSOT Step 4.13). Screens are rendered by module id
 * without props, so a handoff like the Vein Finder's "Plan this" → Cartographer needs a
 * settable navigator that `App` registers with its `setActive`. Kept tiny + injectable so
 * screen tests can spy the handoff without mounting the whole app.
 */

import type { ModuleId } from "./modules.js";

let navigator: (id: ModuleId) => void = () => undefined;

/** `App` registers its module setter here on mount. */
export function setNavigator(fn: (id: ModuleId) => void): void {
  navigator = fn;
}

/** Navigate to a module (no-op until `App` has registered). */
export function navigateTo(id: ModuleId): void {
  navigator(id);
}
