/**
 * A ticking clock hook (Step 1.10). Re-renders on an interval so time-derived UI
 * — data-age staleness, the GAME OFFLINE transition — advances even when no new
 * telemetry arrives. Returns `Date.now()` refreshed every `intervalMs`.
 */

import { useEffect, useState } from "react";

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      clearInterval(id);
    };
  }, [intervalMs]);
  return now;
}
