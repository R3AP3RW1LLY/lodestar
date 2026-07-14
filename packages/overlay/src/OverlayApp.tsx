import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { connectOverlay } from "./ws/loopback-client.js";
import type { WsFactory } from "./ws/loopback-client.js";
import { foldEnvelope, initialOverlayModel } from "./overlay-state.js";
import { VerdictHud } from "./VerdictHud.js";
import { CargoStrip } from "./CargoStrip.js";

/**
 * The overlay root (SSOT Step 2.10). Opens the loopback WS client, folds inbound
 * §5.6 envelopes into the view model, and renders the read-only HUD (verdict +
 * cargo). `pointerEvents: none` is a second click-through guard on top of the
 * window's `setIgnoreMouseEvents(true)`. The socket factory is injected only in
 * tests; production uses the real loopback WebSocket.
 */
const ROOT: CSSProperties = {
  position: "fixed",
  top: "1rem",
  left: "1rem",
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
  fontFamily: '"JetBrains Mono", Consolas, monospace',
  userSelect: "none",
  pointerEvents: "none",
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

  return (
    <div style={ROOT} data-testid="overlay-app">
      <VerdictHud verdict={model.verdict} />
      <CargoStrip state={model.state} />
    </div>
  );
}
