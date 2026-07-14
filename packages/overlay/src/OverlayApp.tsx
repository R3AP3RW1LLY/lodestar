import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { connectOverlay } from "./ws/loopback-client.js";
import type { WsFactory } from "./ws/loopback-client.js";
import { foldEnvelope, initialOverlayModel } from "./overlay-state.js";
import { VerdictHud } from "./VerdictHud.js";
import { CargoStrip } from "./CargoStrip.js";
import { COLORS } from "./overlay-theme.js";

/**
 * The overlay root (SSOT Step 2.10). Opens the loopback WS client, folds inbound
 * §5.6 envelopes into the view model, and renders the read-only HUD (verdict +
 * cargo).
 *
 * Two modes, driven by `overlay.mode` pushed over WS (never local input):
 *  - LOCKED (default): `pointerEvents: none` — a second click-through guard on top
 *    of the window's `setIgnoreMouseEvents(true)`. Pure display.
 *  - ARRANGE (unlocked): the window becomes interactive; a drag bar
 *    (`-webkit-app-region: drag`) moves it and the window edges resize it, so the
 *    commander can place the HUD. Re-locking restores click-through.
 *
 * The socket factory is injected only in tests; production uses the real WebSocket.
 */
const BASE: CSSProperties = {
  position: "fixed",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  fontFamily: '"JetBrains Mono", Consolas, monospace',
  userSelect: "none",
};

const LOCKED_ROOT: CSSProperties = {
  ...BASE,
  top: "1rem",
  left: "1rem",
  pointerEvents: "none",
};

// Arrange mode fills the window so its dashed border shows the bounds and the OS
// resize border along the edges is reachable; the HUD sits below the drag bar.
const ARRANGE_ROOT: CSSProperties = {
  ...BASE,
  inset: 0,
  boxSizing: "border-box",
  gap: "0.4rem",
  padding: "0.5rem",
  pointerEvents: "auto",
  border: `1px dashed ${COLORS.cyan}`,
  background: "rgba(63,221,239,0.05)",
};

/** `-webkit-app-region` (native window drag) isn't in this csstype version. */
type DragStyle = CSSProperties & { readonly WebkitAppRegion?: "drag" | "no-drag" };

const DRAG_BAR: DragStyle = {
  WebkitAppRegion: "drag",
  cursor: "move",
  padding: "0.25rem 0.5rem",
  borderRadius: "0.35rem",
  background: "rgba(9,11,16,0.8)",
  border: "1px solid rgba(255,255,255,0.14)",
  color: COLORS.cyanDim,
  fontSize: "0.6rem",
  letterSpacing: "0.1em",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

// The HUD must NOT be a drag region, or clicks on it in arrange mode would move the
// window instead of leaving the edges free for resize.
const HUD: DragStyle = {
  WebkitAppRegion: "no-drag",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

export function OverlayApp({
  port,
  token,
  factory,
}: {
  readonly port: number;
  readonly token: string;
  readonly factory?: WsFactory;
}): React.JSX.Element {
  const [model, setModel] = useState(initialOverlayModel);

  useEffect(() => {
    const client = connectOverlay({
      port,
      token,
      onEnvelope: (env) => {
        setModel((m) => foldEnvelope(m, env));
      },
      ...(factory !== undefined ? { factory } : {}),
    });
    return () => {
      client.close();
    };
  }, [port, token, factory]);

  const arranging = !model.locked;
  return (
    <div
      style={arranging ? ARRANGE_ROOT : LOCKED_ROOT}
      data-testid="overlay-app"
      data-arranging={arranging ? "true" : "false"}
    >
      {arranging && (
        <div style={DRAG_BAR} data-testid="overlay-dragbar">
          LODESTAR · drag to move · grab an edge to resize · Ctrl+Shift+L to lock
        </div>
      )}
      <div style={HUD}>
        <VerdictHud verdict={model.verdict} />
        <CargoStrip state={model.state} />
      </div>
    </div>
  );
}
