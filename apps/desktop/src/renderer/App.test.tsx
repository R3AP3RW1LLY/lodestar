// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { App } from "./App.js";
import type { LodestarApi } from "../preload/api.js";
import type { RootState } from "@lodestar/shared";

const BASE_SETTINGS = {
  journalPath: null,
  ollamaEndpoint: "http://127.0.0.1:11434",
  aiGpuUuid: null,
  consentWing: false,
  consentCommunity: false,
  consentDiscord: false,
  ttsEnabled: false,
  ttsVoice: "en_US-ryan-high",
  ttsVolume: 0.8,
};

function stubApi(over: Partial<LodestarApi> = {}): void {
  const api: LodestarApi = {
    getHealth: vi
      .fn()
      .mockResolvedValue({ version: "0.1.0", dbStatus: "ok", journalStatus: "not-configured" }),
    getSettings: vi.fn().mockResolvedValue(BASE_SETTINGS),
    setSetting: vi.fn().mockResolvedValue(BASE_SETTINGS),
    autodetectJournal: vi.fn().mockResolvedValue({ path: null }),
    getSecretsPresence: vi
      .fn()
      .mockResolvedValue({ inaraApiKey: false, capiTokens: false, discordWebhookUrl: false }),
    setSecret: vi
      .fn()
      .mockResolvedValue({ inaraApiKey: false, capiTokens: false, discordWebhookUrl: false }),
    listGpus: vi.fn().mockResolvedValue([]),
    getStateSnapshot: vi.fn((): Promise<RootState> => new Promise(() => {})),
    onStateDelta: vi.fn(() => () => {}),
    onSessionStats: vi.fn(() => () => {}),
    testTts: vi.fn().mockResolvedValue({ ok: true, error: null }),
    listVoices: vi.fn().mockResolvedValue([
      { id: "en_US-ryan-high", displayName: "Ryan" },
      { id: "en_US-libritts-high", displayName: "LibriTTS" },
    ]),
    onTtsAudio: vi.fn(() => () => {}),
    onAssayVerdict: vi.fn(() => () => {}),
    toggleOverlay: vi.fn().mockResolvedValue({ visible: false }),
    lockOverlay: vi.fn().mockResolvedValue({ locked: true }),
    exportAnalytics: vi.fn().mockResolvedValue({ ok: false, path: null }),
    getManifest: vi.fn(),
    getSessionDetail: vi.fn().mockResolvedValue(null),
    getLedgerBoard: vi.fn().mockResolvedValue([]),
    getLedgerStations: vi.fn().mockResolvedValue([]),
    getLedgerTrend: vi.fn().mockResolvedValue([]),
    listAlerts: vi.fn().mockResolvedValue([]),
    addAlert: vi.fn().mockResolvedValue([]),
    setAlertEnabled: vi.fn().mockResolvedValue([]),
    deleteAlert: vi.fn().mockResolvedValue([]),
    planRuns: vi.fn().mockResolvedValue([]),
    savePlan: vi.fn().mockResolvedValue({ runId: null }),
    findVeins: vi.fn().mockResolvedValue([]),
    adviseOutfit: vi.fn().mockResolvedValue({
      method: "laser",
      ship: null,
      hasLoadout: false,
      present: [],
      missingRequired: [],
      suggestions: [],
    }),
    ...over,
  };
  (globalThis as unknown as { window: { lodestar: LodestarApi } }).window.lodestar = api;
}

afterEach(cleanup);

describe("App shell", () => {
  it("shows the Command Deck by default and a live status bar", async () => {
    stubApi();
    render(<App />);
    expect(screen.getByRole("heading", { name: /command deck/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("status-db")).toHaveAttribute("data-status", "ok");
    });
    expect(screen.getByTestId("status-journal")).toHaveAttribute("data-status", "not-configured");
  });

  it("navigates to Settings and back to Command Deck via the nav rail", async () => {
    stubApi();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    await waitFor(() => {
      expect(screen.getByTestId("settings-screen")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole("button", { name: /command deck/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /command deck/i })).toBeInTheDocument();
    });
    // Returning leaves no stale Settings screen behind.
    expect(screen.queryByTestId("settings-screen")).not.toBeInTheDocument();
  });

  it("stops polling health after unmount (no leaked interval)", () => {
    vi.useFakeTimers();
    try {
      const getHealth = vi
        .fn()
        .mockResolvedValue({ version: "0.1.0", dbStatus: "ok", journalStatus: "ok" });
      stubApi({ getHealth });
      const { unmount } = render(<App />);
      const callsAtUnmount = getHealth.mock.calls.length;
      unmount();
      vi.advanceTimersByTime(30_000);
      expect(getHealth.mock.calls.length).toBe(callsAtUnmount);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows 'connection lost' when a previously-good health poll starts failing", async () => {
    const getHealth = vi
      .fn()
      .mockResolvedValueOnce({ version: "0.1.0", dbStatus: "ok", journalStatus: "ok" })
      .mockRejectedValue(new Error("main gone"));
    stubApi({ getHealth });
    vi.useFakeTimers();
    try {
      render(<App />);
      // Let the first (successful) poll resolve.
      await vi.advanceTimersByTimeAsync(0);
      // Advance past the poll interval to trigger the failing poll.
      await vi.advanceTimersByTimeAsync(5000);
      expect(screen.getByText(/connection lost/i)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT claim 'connection lost' while it has never connected (still starting up)", async () => {
    const getHealth = vi.fn().mockRejectedValue(new Error("main not ready"));
    stubApi({ getHealth });
    vi.useFakeTimers();
    try {
      render(<App />);
      // Two failing polls, never a success → everConnected stays false.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5000);
      expect(screen.queryByText(/connection lost/i)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an 'arrives in Phase N' notice for an unbuilt module (no dead link)", () => {
    stubApi();
    render(<App />);
    // Assistant's nav button is disabled; the nav communicates the arrival phase.
    expect(screen.getByRole("button", { name: /assistant/i })).toHaveTextContent(/phase 5/i);
  });
});
