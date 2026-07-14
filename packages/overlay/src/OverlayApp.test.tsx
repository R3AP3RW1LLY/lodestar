import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { envelope, initialRootState } from "@lodestar/shared";
import type { AssayVerdictEvent, Envelope } from "@lodestar/shared";
import { OverlayApp } from "./OverlayApp.js";
import type { WsFactory, WsMessage } from "./ws/loopback-client.js";

const MINE: AssayVerdictEvent = {
  prospectId: 3,
  call: "MINE",
  score: 90_000,
  reasons: [{ code: "proportion-above-threshold", commodityId: "painite" }],
  method: "laser",
  timestamp: "2025-06-01T12:00:00Z",
  content: "$AsteroidMaterialContent_High;",
  remainingPct: 100,
  materials: [{ name: "painite", displayName: "Painite", proportion: 24 }],
};

/** A fake socket factory that lets the test push frames as if from the WS server. */
function capturingFactory(): { factory: WsFactory; send: (env: Envelope) => void } {
  let emit: ((type: string, ev: WsMessage) => void) | undefined;
  const factory: WsFactory = () => {
    const listeners = new Map<string, ((ev: WsMessage) => void)[]>();
    emit = (type, ev) => {
      for (const l of listeners.get(type) ?? []) l(ev);
    };
    return {
      addEventListener: (type, listener) => {
        const arr = listeners.get(type) ?? [];
        arr.push(listener);
        listeners.set(type, arr);
      },
      close: () => {},
    };
  };
  return {
    factory,
    send: (env) => {
      emit?.("message", { data: JSON.stringify(env) });
    },
  };
}

afterEach(cleanup);

describe("OverlayApp", () => {
  it("shows the idle HUD before any data", () => {
    const { factory } = capturingFactory();
    render(<OverlayApp port={1} token="t" factory={factory} />);
    expect(screen.getByTestId("verdict-hud").textContent).toContain("AWAITING PROSPECT");
    // No capacity known yet → cargo shows raw tonnage and no fill bar.
    expect(screen.getByTestId("cargo-value").textContent).toContain("0 t");
    expect(screen.queryByTestId("cargo-fill")).toBeNull();
  });

  it("renders verdict + cargo from state.snapshot and assay.verdict WS pushes", () => {
    const { factory, send } = capturingFactory();
    render(<OverlayApp port={1} token="t" factory={factory} />);
    act(() => {
      send(
        envelope("state.snapshot", {
          ...initialRootState(),
          ship: { cargoCapacity: 256 },
          cargo: { count: 64, items: [] },
        }),
      );
      send(envelope("assay.verdict", MINE));
    });
    expect(screen.getByTestId("verdict-call").textContent).toBe("MINE");
    expect(screen.getByTestId("verdict-top").textContent).toContain("Painite");
    expect(screen.getByTestId("cargo-value").textContent).toContain("64 / 256 t");
    expect(screen.getByTestId("cargo-value").textContent).toContain("25%");
    expect(screen.getByTestId("cargo-fill")).toBeTruthy();
  });

  it("shows the arrange chrome (drag bar) only when unlocked via overlay.mode", () => {
    const { factory, send } = capturingFactory();
    render(<OverlayApp port={1} token="t" factory={factory} />);
    // Locked by default → no drag bar, click-through.
    expect(screen.queryByTestId("overlay-dragbar")).toBeNull();
    expect(screen.getByTestId("overlay-app").getAttribute("data-arranging")).toBe("false");
    act(() => {
      send(envelope("overlay.mode", { locked: false }));
    });
    expect(screen.getByTestId("overlay-dragbar")).toBeTruthy();
    expect(screen.getByTestId("overlay-app").getAttribute("data-arranging")).toBe("true");
    // Re-lock → chrome gone.
    act(() => {
      send(envelope("overlay.mode", { locked: true }));
    });
    expect(screen.queryByTestId("overlay-dragbar")).toBeNull();
  });

  it("updates cargo on a state.delta push", () => {
    const { factory, send } = capturingFactory();
    render(<OverlayApp port={1} token="t" factory={factory} />);
    act(() => {
      send(
        envelope("state.snapshot", {
          ...initialRootState(),
          ship: { cargoCapacity: 200 },
          cargo: { count: 0, items: [] },
        }),
      );
      send(envelope("state.delta", { cargo: { count: 100, items: [] } }));
    });
    expect(screen.getByTestId("cargo-value").textContent).toContain("100 / 200 t");
    expect(screen.getByTestId("cargo-value").textContent).toContain("50%");
  });
});
