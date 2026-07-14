import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OverlayApp } from "@lodestar/overlay";

/**
 * The overlay renderer entry (Step 2.10). Reads the WS connection info the overlay
 * preload exposed (port + token, from argv) and mounts the read-only HUD. If the
 * info is absent (preload failed) it mounts nothing rather than crash — an empty
 * transparent window is a safe degraded state.
 */
const container = document.getElementById("overlay-root");
if (container === null) throw new Error("overlay root container missing");

const connection = window.lodestarOverlay;
createRoot(container).render(
  <StrictMode>
    {connection !== null ? <OverlayApp port={connection.port} token={connection.token} /> : null}
  </StrictMode>,
);
