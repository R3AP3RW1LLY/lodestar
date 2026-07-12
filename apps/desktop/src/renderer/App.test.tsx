// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { App } from "./App.js";
import type { AppHealth } from "@lodestar/shared";

function stubLodestar(getHealth: () => Promise<AppHealth>): void {
  (
    globalThis as unknown as { window: { lodestar: { getHealth: () => Promise<AppHealth> } } }
  ).window.lodestar = { getHealth };
}

afterEach(() => {
  cleanup();
});

describe("App", () => {
  it("shows the health payload on success", async () => {
    stubLodestar(() =>
      Promise.resolve({ version: "0.1.0", dbStatus: "ok", journalStatus: "not-configured" }),
    );
    render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId("version")).toHaveTextContent("0.1.0");
    });
    expect(screen.getByTestId("db-status")).toHaveTextContent("ok");
    expect(screen.getByTestId("journal-status")).toHaveTextContent("not-configured");
  });

  it("shows a typed error when the IPC call rejects", async () => {
    stubLodestar(() => Promise.reject(new Error("health.failed: probe failed")));
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText(/health error:/)).toHaveTextContent("probe failed");
    });
  });

  it("shows a querying state before the health resolves", () => {
    stubLodestar(() => new Promise<AppHealth>(() => undefined));
    render(<App />);
    expect(screen.getByText(/querying health/)).toBeInTheDocument();
  });
});
