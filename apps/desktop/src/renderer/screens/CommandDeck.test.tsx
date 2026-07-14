// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { initialRootState } from "@lodestar/shared";
import type { RootState, SessionSummary } from "@lodestar/shared";
import { useGameState } from "../stores/game-state.js";
import { CommandDeck } from "./CommandDeck.js";

/** Fake the preload API so the store subscription is inert and config is controllable. */
function stubApi(journalPath: string | null = "C:/journal"): void {
  const api = {
    getSettings: vi.fn().mockResolvedValue({ journalPath }),
    // Never resolves → the store keeps whatever we setState below (no hydrate overwrite).
    getStateSnapshot: vi.fn(() => new Promise<RootState>(() => {})),
    onStateDelta: vi.fn(() => () => {}),
    onSessionStats: vi.fn(() => () => {}),
    toggleOverlay: vi.fn().mockResolvedValue({ visible: true }),
  };
  (globalThis as unknown as { window: { lodestar: unknown } }).window.lodestar = api;
}

function setStore(state: RootState, session: SessionSummary | null): void {
  useGameState.setState({ state, session, connected: true });
}

const NOW = Date.parse("2025-06-01T12:00:05Z");
const FRESH = "2025-06-01T12:00:04Z"; // 1s before NOW → online
const STALE = "2025-06-01T11:55:00Z"; // 5m before NOW → offline

const MINING_STATE: RootState = {
  ...initialRootState(),
  ship: {
    type: "python",
    name: "LODESTAR TEST",
    ident: "LS-01",
    cargoCapacity: 256,
    maxJumpRange: 22.55,
    fuelMain: 29.89,
  },
  location: { docked: false, system: "Paesia", body: "Paesia 2 A Ring", ring: "Paesia 2 A Ring" },
  cargo: { count: 5, items: [{ name: "painite", count: 5 }] },
  activity: "mining",
  pips: { sys: 2, eng: 4, wep: 0 },
  timestamp: FRESH,
};

const MINING_SESSION: SessionSummary = {
  active: true,
  startedAt: "2025-06-01T11:55:00Z",
  tonsRefined: 5,
  tonsPerHour: 22.2,
  creditsEarned: 2_500_000,
  creditsPerHour: 11_111_111,
  limpetsLaunched: 3,
  bankedToCarrier: 0,
};

beforeEach(() => {
  useGameState.setState({ state: initialRootState(), session: null, connected: false });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("CommandDeck", () => {
  it("renders live panel values with a LIVE (online) status when writes are fresh", async () => {
    stubApi("C:/journal");
    setStore(MINING_STATE, MINING_SESSION);
    render(<CommandDeck nowMs={NOW} />);

    expect((await screen.findByTestId("deck-status")).getAttribute("data-mode")).toBe("online");
    // Vessel reference strip: identity present, fuel is NOT here (deduplicated).
    expect(screen.getByText("python")).toBeInTheDocument();
    expect(screen.getByText("LS-01")).toBeInTheDocument();
    // Situation: system + place (the ring string already carries the system prefix,
    // so it renders exactly once — no more triple-rendered location).
    expect(screen.getByTestId("situation-system").textContent).toBe("Paesia");
    expect(screen.getByText("Paesia 2 A Ring")).toBeInTheDocument();
    expect(screen.getByTestId("situation-dock").textContent).toBe("In Flight");
    expect(screen.getByTestId("activity-value").textContent).toBe("Mining");
    expect(screen.getByText("painite")).toBeInTheDocument();
    // Cargo hold: fill gauge against ship capacity (5 / 256 t → 2%).
    expect(screen.getByTestId("cargo-pct").textContent).toBe("2%");
    expect(screen.getByTestId("cargo-fill")).toBeInTheDocument();
    // Fuel + pips (sys 2 / eng 4 / wep 0) — the deck's single fuel readout.
    expect(screen.getByLabelText("SYS 2 of 4")).toBeInTheDocument();
    expect(screen.getByLabelText("ENG 4 of 4")).toBeInTheDocument();
    expect(screen.getByLabelText("WEP 0 of 4")).toBeInTheDocument();
    expect(screen.getAllByText("29.89 t")).toHaveLength(1); // fuel main, shown exactly once
    expect(screen.getByTestId("session-status").textContent).toBe("active");
    expect(screen.getByText("22.2")).toBeInTheDocument(); // tons/hr
    expect(screen.getByText("2,500,000 cr")).toBeInTheDocument(); // credits earned
    expect(screen.getByText("11,111,111 cr")).toBeInTheDocument(); // credits/hr
  });

  it("shows GAME OFFLINE over the last-known snapshot when writes go stale", async () => {
    stubApi("C:/journal");
    setStore({ ...MINING_STATE, timestamp: STALE, activity: "supercruise" }, null);
    render(<CommandDeck nowMs={NOW} />);

    const status = await screen.findByTestId("deck-status");
    expect(status.getAttribute("data-mode")).toBe("offline");
    expect(status.textContent).toContain("Game Offline");
    expect(screen.getByText("python")).toBeInTheDocument(); // last-known still shown
    expect(screen.getByTestId("session-empty")).toBeInTheDocument();
  });

  it("asks main to toggle the in-game overlay when the overlay button is clicked", async () => {
    stubApi("C:/journal");
    setStore(MINING_STATE, MINING_SESSION);
    render(<CommandDeck nowMs={NOW} />);
    const btn = await screen.findByTestId("overlay-toggle");
    const toggle = (window.lodestar as unknown as { toggleOverlay: ReturnType<typeof vi.fn> })
      .toggleOverlay;
    fireEvent.click(btn);
    expect(toggle).toHaveBeenCalledOnce();
  });

  it("guides the commander to Settings when no journal is configured", async () => {
    stubApi(null);
    setStore(initialRootState(), null);
    render(<CommandDeck nowMs={NOW} />);

    expect(await screen.findByTestId("deck-not-configured")).toBeInTheDocument();
    expect(screen.getByText(/Settings/)).toBeInTheDocument();
  });

  it("renders an empty hold + nominal activity + no-session for the initial state", async () => {
    stubApi("C:/journal");
    setStore({ ...initialRootState(), timestamp: FRESH }, null);
    render(<CommandDeck nowMs={NOW} />);
    await screen.findByTestId("deck-status");
    expect(screen.getByText("hold empty")).toBeInTheDocument();
    // Capacity unknown ⇒ no fill bar (never a misleading gauge).
    expect(screen.queryByTestId("cargo-fill")).toBeNull();
    expect(screen.getByText("nominal")).toBeInTheDocument();
    expect(screen.getByText("no active mining session")).toBeInTheDocument();
  });
});
