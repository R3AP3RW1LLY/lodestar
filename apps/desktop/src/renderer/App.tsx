import { useEffect, useState } from "react";
import type { AppHealth } from "@lodestar/shared";

/**
 * Phase-0 Command Deck shell: proves the typed IPC round-trip by fetching and
 * displaying app.health. The full cockpit-MFD shell arrives in Steps 0.5/0.9.
 */
export function App(): React.JSX.Element {
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.lodestar
      .getHealth()
      .then(setHealth)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, []);

  return (
    <main
      style={{
        fontFamily: "monospace",
        color: "#ff7100",
        background: "#0a0a0f",
        minHeight: "100vh",
        padding: 24,
      }}
    >
      <h1>LODESTAR</h1>
      {error !== null && <p style={{ color: "#ff4444" }}>health error: {error}</p>}
      {health === null && error === null && <p>querying health…</p>}
      {health !== null && (
        <dl>
          <dt>version</dt>
          <dd data-testid="version">{health.version}</dd>
          <dt>database</dt>
          <dd data-testid="db-status">{health.dbStatus}</dd>
          <dt>journal</dt>
          <dd data-testid="journal-status">{health.journalStatus}</dd>
        </dl>
      )}
    </main>
  );
}
