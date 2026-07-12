/**
 * Single-instance enforcement (SSOT Step 0.4): a second launch must not open a
 * second window — that would double journal ingestion and contend on SQLite.
 * The decision is extracted so it is testable without a live Electron app.
 */

export interface SingleInstanceApp {
  requestSingleInstanceLock: () => boolean;
  on: (event: "second-instance", listener: () => void) => void;
  quit: () => void;
}

/**
 * Returns true if this process holds the lock and should proceed to boot;
 * false if another instance already owns it (this process has been told to
 * quit). When it proceeds, a second-instance event focuses the existing window.
 */
export function acquireSingleInstance(app: SingleInstanceApp, focusExisting: () => void): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on("second-instance", () => {
    focusExisting();
  });
  return true;
}
