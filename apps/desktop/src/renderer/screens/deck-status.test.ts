import { describe, expect, it } from "vitest";
import { deriveDeckStatus } from "./deck-status.js";

const T0 = Date.parse("2025-06-01T12:00:00Z");

describe("deriveDeckStatus", () => {
  it("is not-configured only when there is no journal path AND no data yet", () => {
    expect(deriveDeckStatus({ journalConfigured: false, timestamp: undefined, nowMs: T0 })).toEqual(
      { mode: "not-configured" },
    );
  });

  it("shows the deck (not not-configured) once data flows, even without a settings path", () => {
    // e.g. the LODESTAR_JOURNAL_DIR override: engine produces data, settings path null.
    expect(
      deriveDeckStatus({
        journalConfigured: false,
        timestamp: "2025-06-01T12:00:00Z",
        nowMs: T0 + 1_000,
      }),
    ).toEqual({ mode: "online", timestamp: "2025-06-01T12:00:00Z" });
  });

  it("is offline with no timestamp yet (no fabricated time)", () => {
    expect(deriveDeckStatus({ journalConfigured: true, timestamp: undefined, nowMs: T0 })).toEqual({
      mode: "offline",
    });
  });

  it("is online (carrying the fresh timestamp) within the freshness window", () => {
    expect(
      deriveDeckStatus({
        journalConfigured: true,
        timestamp: "2025-06-01T12:00:00Z",
        nowMs: T0 + 3_000,
      }),
    ).toEqual({ mode: "online", timestamp: "2025-06-01T12:00:00Z" });
  });

  it("is offline (keeping the last-known timestamp) once writes exceed the window", () => {
    expect(
      deriveDeckStatus({
        journalConfigured: true,
        timestamp: "2025-06-01T12:00:00Z",
        nowMs: T0 + 30_000,
      }),
    ).toEqual({ mode: "offline", timestamp: "2025-06-01T12:00:00Z" });
  });

  it("undefined journalConfigured (settings not read) is not treated as not-configured", () => {
    expect(
      deriveDeckStatus({
        journalConfigured: undefined,
        timestamp: "2025-06-01T12:00:00Z",
        nowMs: T0 + 1_000,
      }).mode,
    ).toBe("online");
  });

  it("treats an unparseable timestamp as offline", () => {
    expect(
      deriveDeckStatus({ journalConfigured: true, timestamp: "not-a-date", nowMs: T0 }).mode,
    ).toBe("offline");
  });
});
