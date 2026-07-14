import type { ElectronApplication, Page } from "@playwright/test";

/**
 * Deterministically return the MAIN (Command Deck) window.
 *
 * Step 2.10 added a second window — the transparent overlay (`overlay.html`) —
 * which loads a much smaller page and can win `app.firstWindow()`. Worse, the
 * overlay has NO `window.lodestar` bridge (it's WS-only), so a spec that grabbed
 * it would break. Select by URL instead (the built main window is `index.html`,
 * the overlay is `overlay.html`), polling until it has settled past `about:blank`.
 */
export async function mainWindow(app: ElectronApplication): Promise<Page> {
  for (let i = 0; i < 300; i++) {
    const win = app.windows().find((w) => w.url().endsWith("index.html"));
    if (win !== undefined) return win;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("main (Command Deck) window did not appear within 30s");
}
