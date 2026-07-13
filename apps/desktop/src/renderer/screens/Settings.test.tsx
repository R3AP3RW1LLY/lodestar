// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { Settings } from "./Settings.js";
import type { LodestarApi } from "../../preload/api.js";

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
const BASE_PRESENCE = { inaraApiKey: false, capiTokens: false, discordWebhookUrl: false };

function stubApi(over: Partial<LodestarApi> = {}): LodestarApi {
  const api: LodestarApi = {
    getHealth: vi
      .fn()
      .mockResolvedValue({ version: "0.1.0", dbStatus: "ok", journalStatus: "not-configured" }),
    getSettings: vi.fn().mockResolvedValue(BASE_SETTINGS),
    setSetting: vi.fn().mockResolvedValue(BASE_SETTINGS),
    autodetectJournal: vi.fn().mockResolvedValue({ path: null }),
    getSecretsPresence: vi.fn().mockResolvedValue(BASE_PRESENCE),
    setSecret: vi.fn().mockResolvedValue(BASE_PRESENCE),
    listGpus: vi.fn().mockResolvedValue([]),
    getStateSnapshot: vi.fn(),
    onStateDelta: vi.fn(() => () => {}),
    onSessionStats: vi.fn(() => () => {}),
    testTts: vi.fn().mockResolvedValue({ ok: true, error: null }),
    onTtsAudio: vi.fn(() => () => {}),
    ...over,
  };
  (globalThis as unknown as { window: { lodestar: LodestarApi } }).window.lodestar = api;
  return api;
}

afterEach(cleanup);
beforeEach(() => {
  stubApi();
});

describe("Settings screen", () => {
  it("loads and displays current settings", async () => {
    stubApi({
      getSettings: vi.fn().mockResolvedValue({ ...BASE_SETTINGS, journalPath: "D:/journal" }),
    });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByLabelText(/journal path/i)).toHaveValue("D:/journal");
    });
    expect(screen.getByLabelText(/ollama endpoint/i)).toHaveValue("http://127.0.0.1:11434");
  });

  it("TTS: plays a voice test and shows the success note", async () => {
    const testTts = vi.fn().mockResolvedValue({ ok: true, error: null });
    stubApi({ testTts });
    render(<Settings />);
    await userEvent.click(await screen.findByRole("button", { name: /test voice/i }));
    await waitFor(() => {
      expect(testTts).toHaveBeenCalled();
    });
    expect(screen.getByTestId("tts-note")).toHaveTextContent(/voice test played/i);
  });

  it("TTS: shows a failure note when the voice test fails", async () => {
    stubApi({ testTts: vi.fn().mockResolvedValue({ ok: false, error: "not-installed" }) });
    render(<Settings />);
    await userEvent.click(await screen.findByRole("button", { name: /test voice/i }));
    await waitFor(() => {
      expect(screen.getByTestId("tts-note")).toHaveTextContent(/failed/i);
    });
  });

  it("TTS: toggling enable persists ttsEnabled; the volume slider persists ttsVolume", async () => {
    const setSetting = vi.fn().mockResolvedValue({ ...BASE_SETTINGS, ttsEnabled: true });
    stubApi({ setSetting });
    render(<Settings />);
    await userEvent.click(await screen.findByLabelText(/enable voice callouts/i));
    await waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith({ key: "ttsEnabled", value: true });
    });
    const slider = screen.getByLabelText(/tts volume/i);
    fireEvent.change(slider, { target: { value: "0.5" } }); // live visual
    fireEvent.keyUp(slider); // commit persists
    await waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith({ key: "ttsVolume", value: 0.5 });
    });
  });

  it("persists a valid Ollama endpoint change and reflects the server's returned value", async () => {
    const saved = { ...BASE_SETTINGS, ollamaEndpoint: "http://127.0.0.1:9999" };
    const setSetting = vi.fn().mockResolvedValue(saved);
    stubApi({ setSetting });
    render(<Settings />);
    const input = await screen.findByLabelText(/ollama endpoint/i);
    await userEvent.clear(input);
    await userEvent.type(input, "http://127.0.0.1:9999");
    await userEvent.click(screen.getByRole("button", { name: /save ollama/i }));
    await waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith({
        key: "ollamaEndpoint",
        value: "http://127.0.0.1:9999",
      });
    });
    expect(input).toHaveValue("http://127.0.0.1:9999");
  });

  it("saves aiGpuUuid — including via Detect GPUs (the field truly persists)", async () => {
    const saved = { ...BASE_SETTINGS, aiGpuUuid: "GPU-5612e762-42fc" };
    const setSetting = vi.fn().mockResolvedValue(saved);
    const listGpus = vi
      .fn()
      .mockResolvedValue([
        { index: 1, uuid: "GPU-5612e762-42fc", name: "RTX 3060", memoryTotalMiB: 12288 },
      ]);
    stubApi({ setSetting, listGpus });
    render(<Settings />);
    await userEvent.click(await screen.findByRole("button", { name: /detect gpus/i }));
    await waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith({ key: "aiGpuUuid", value: "GPU-5612e762-42fc" });
    });
    expect(screen.getByLabelText(/ai gpu uuid/i)).toHaveValue("GPU-5612e762-42fc");
  });

  it("warns when a saved journal path has no journal files (content validation)", async () => {
    const setSetting = vi.fn().mockResolvedValue({ ...BASE_SETTINGS, journalPath: "D:/empty" });
    const getHealth = vi
      .fn()
      .mockResolvedValue({ version: "0.1.0", dbStatus: "ok", journalStatus: "error" });
    stubApi({ setSetting, getHealth });
    render(<Settings />);
    const input = await screen.findByLabelText(/journal path/i);
    await userEvent.type(input, "D:/empty");
    await userEvent.click(screen.getByRole("button", { name: /save journal/i }));
    await waitFor(() => {
      expect(screen.getByText(/no Journal.*log files/i)).toBeInTheDocument();
    });
  });

  it("shows a validation error when saving an invalid setting is rejected", async () => {
    const setSetting = vi.fn().mockResolvedValue(BASE_SETTINGS);
    // The API layer throws on a rejected wire result; simulate that.
    setSetting.mockRejectedValueOnce(new Error("settings.invalid-value: bad endpoint"));
    stubApi({ setSetting });
    render(<Settings />);
    const input = await screen.findByLabelText(/ollama endpoint/i);
    await userEvent.clear(input);
    await userEvent.type(input, "http://evil.example.com");
    await userEvent.click(screen.getByRole("button", { name: /save ollama/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid-value/i)).toBeInTheDocument();
    });
  });

  it("auto-detects the journal path and fills the field", async () => {
    const autodetectJournal = vi
      .fn()
      .mockResolvedValue({ path: "C:/Users/me/Saved Games/.../Elite Dangerous" });
    stubApi({ autodetectJournal });
    render(<Settings />);
    await userEvent.click(await screen.findByRole("button", { name: /auto-detect/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/journal path/i)).toHaveValue(
        "C:/Users/me/Saved Games/.../Elite Dangerous",
      );
    });
  });

  it("renders consent toggles READ-ONLY with a Phase-10 notice (never interactive)", async () => {
    render(<Settings />);
    const wing = await screen.findByLabelText(/wing sharing/i);
    expect(wing).toBeDisabled();
    expect(wing).not.toBeChecked();
    expect(screen.getByText(/privacy panel/i)).toBeInTheDocument();
  });

  it("stores an API key via setSecret without displaying its value, and shows presence", async () => {
    const setSecret = vi.fn().mockResolvedValue({ ...BASE_PRESENCE, inaraApiKey: true });
    stubApi({ setSecret });
    render(<Settings />);
    const keyInput = await screen.findByLabelText(/inara api key/i);
    expect(keyInput).toHaveAttribute("type", "password");
    await userEvent.type(keyInput, "sk-LIVE-secret");
    await userEvent.click(screen.getByRole("button", { name: /save inara/i }));
    await waitFor(() => {
      expect(setSecret).toHaveBeenCalledWith({ key: "inaraApiKey", value: "sk-LIVE-secret" });
    });
    // The plaintext is cleared from the field on success (no stale secret in DOM).
    expect(keyInput).toHaveValue("");
    // Presence indicator reflects the stored state; the value is never rendered.
    await waitFor(() => {
      expect(screen.getByTestId("inaraApiKey-presence")).toHaveTextContent(/set/i);
    });
  });

  it("surfaces an error when saving a secret fails (encryption unavailable)", async () => {
    const setSecret = vi
      .fn()
      .mockRejectedValue(new Error("secrets.encryption-unavailable: refused"));
    stubApi({ setSecret });
    render(<Settings />);
    const keyInput = await screen.findByLabelText(/inara api key/i);
    await userEvent.type(keyInput, "sk-LIVE-secret");
    await userEvent.click(screen.getByRole("button", { name: /save inara/i }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/encryption-unavailable/i);
    });
    // On failure the value is NOT cleared, so the user can retry.
    expect(keyInput).toHaveValue("sk-LIVE-secret");
  });

  it("clears a stored secret via the Clear button (null write)", async () => {
    const setSecret = vi.fn().mockResolvedValue({ ...BASE_PRESENCE, inaraApiKey: false });
    stubApi({ setSecret });
    render(<Settings />);
    await screen.findByLabelText(/inara api key/i);
    const clearButtons = screen.getAllByRole("button", { name: /^clear$/i });
    await userEvent.click(clearButtons[0]!);
    await waitFor(() => {
      expect(setSecret).toHaveBeenCalledWith({ key: "inaraApiKey", value: null });
    });
  });

  it("surfaces an error when the initial settings load fails", async () => {
    stubApi({ getSettings: vi.fn().mockRejectedValue(new Error("db.unavailable: no profile")) });
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/db.unavailable/i)).toBeInTheDocument();
    });
    // With no settings loaded, the form stays in its loading state (never crashes).
    expect(screen.getByText(/loading settings/i)).toBeInTheDocument();
  });

  it("saves the AI GPU UUID via its dedicated Save button", async () => {
    const saved = { ...BASE_SETTINGS, aiGpuUuid: "GPU-manual-entry" };
    const setSetting = vi.fn().mockResolvedValue(saved);
    stubApi({ setSetting });
    render(<Settings />);
    const input = await screen.findByLabelText(/ai gpu uuid/i);
    await userEvent.type(input, "GPU-manual-entry");
    await userEvent.click(screen.getByRole("button", { name: /save ai gpu/i }));
    await waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith({ key: "aiGpuUuid", value: "GPU-manual-entry" });
    });
  });

  it("normalizes a cleared AI GPU field to null (empty string is not a UUID)", async () => {
    const setSetting = vi.fn().mockResolvedValue(BASE_SETTINGS);
    stubApi({
      getSettings: vi.fn().mockResolvedValue({ ...BASE_SETTINGS, aiGpuUuid: "GPU-old" }),
      setSetting,
    });
    render(<Settings />);
    const input = await screen.findByLabelText(/ai gpu uuid/i);
    expect(input).toHaveValue("GPU-old");
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole("button", { name: /save ai gpu/i }));
    await waitFor(() => {
      expect(setSetting).toHaveBeenCalledWith({ key: "aiGpuUuid", value: null });
    });
  });

  it("surfaces an error when clearing a secret fails", async () => {
    const setSecret = vi.fn().mockRejectedValue(new Error("secrets.write-failed: disk"));
    stubApi({ setSecret });
    render(<Settings />);
    await screen.findByLabelText(/inara api key/i);
    const clearButtons = screen.getAllByRole("button", { name: /^clear$/i });
    await userEvent.click(clearButtons[0]!);
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/write-failed/i);
    });
  });
});
