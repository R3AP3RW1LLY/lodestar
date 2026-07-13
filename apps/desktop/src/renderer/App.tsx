import { useEffect, useState } from "react";
import type { AppHealth } from "@lodestar/shared";
import { NavRail } from "./components/NavRail.js";
import { StatusBar } from "./components/StatusBar.js";
import { ModuleView } from "./routes.js";
import type { ModuleId } from "./modules.js";

const HEALTH_POLL_MS = 5000;

/**
 * The app shell (Step 0.9): nav rail + routed module view + live status bar.
 * Health is polled so the DB/journal indicators reflect real probe state.
 */
export function App(): React.JSX.Element {
  const [active, setActive] = useState<ModuleId>("command-deck");
  const [health, setHealth] = useState<AppHealth | null>(null);
  const [connectionLost, setConnectionLost] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let everConnected = false;
    const poll = (): void => {
      window.lodestar
        .getHealth()
        .then((h) => {
          if (cancelled) return;
          everConnected = true;
          setHealth(h);
          setConnectionLost(false);
        })
        .catch(() => {
          if (cancelled) return;
          // Distinguish "never connected" (still connecting) from a lost link.
          if (everConnected) setConnectionLost(true);
        });
    };
    poll();
    const timer = setInterval(poll, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col text-orange">
      <div className="flex min-h-0 flex-1">
        <NavRail active={active} onSelect={setActive} />
        <main className="min-h-0 flex-1 overflow-auto">
          <ModuleView active={active} />
        </main>
      </div>
      <StatusBar health={health} connectionLost={connectionLost} />
    </div>
  );
}
