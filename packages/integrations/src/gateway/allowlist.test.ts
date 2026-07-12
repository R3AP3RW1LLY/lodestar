import { describe, expect, it } from "vitest";
import {
  DENIED_AI_HOSTS,
  INSTALL_ALLOWLIST,
  RUNTIME_ALLOWLIST,
  hostAllowlist,
} from "./allowlist.js";

describe("allowlists", () => {
  it("match hosts exactly", () => {
    expect(RUNTIME_ALLOWLIST.has("www.edsm.net")).toBe(true);
    expect(RUNTIME_ALLOWLIST.has("edsm.net")).toBe(false);
    expect(INSTALL_ALLOWLIST.has("github.com")).toBe(true);
    // Runtime and install allowlists are disjoint in their sensitive entries.
    expect(RUNTIME_ALLOWLIST.has("github.com")).toBe(false);
    expect(INSTALL_ALLOWLIST.has("www.edsm.net")).toBe(false);
  });

  it("never contain any denied AI/ML inference host", () => {
    for (const host of DENIED_AI_HOSTS) {
      expect(RUNTIME_ALLOWLIST.has(host)).toBe(false);
      expect(INSTALL_ALLOWLIST.has(host)).toBe(false);
    }
  });

  it("are immutable — the exposed object has no mutators and cannot gain a host", () => {
    const asRecord = RUNTIME_ALLOWLIST as unknown as Record<string, unknown>;
    // No add/delete/clear leaked onto the frozen wrapper.
    expect(asRecord["add"]).toBeUndefined();
    expect(asRecord["delete"]).toBeUndefined();
    expect(Object.isFrozen(RUNTIME_ALLOWLIST)).toBe(true);
  });

  it("hostAllowlist builds an independent frozen set (mutating the input array is inert)", () => {
    const input = ["a.example"];
    const allow = hostAllowlist(input);
    input.push("b.example");
    expect(allow.has("a.example")).toBe(true);
    expect(allow.has("b.example")).toBe(false);
  });
});
