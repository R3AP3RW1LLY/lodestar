import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileOverlayStateStore } from "./overlay-state-store.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lodestar-overlay-"));
  path = join(dir, "overlay-state.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("fileOverlayStateStore", () => {
  it("has no saved placement when the file is missing", () => {
    expect(fileOverlayStateStore(path).load()).toEqual({});
  });

  it("round-trips the saved bounds", () => {
    const store = fileOverlayStateStore(path);
    store.save({ bounds: { x: 10, y: 20, width: 300, height: 200 } });
    expect(store.load()).toEqual({ bounds: { x: 10, y: 20, width: 300, height: 200 } });
  });

  it("falls back to no placement on a corrupt file", () => {
    writeFileSync(path, "{ not json", "utf8");
    expect(fileOverlayStateStore(path).load()).toEqual({});
  });

  it("drops invalid/degenerate bounds", () => {
    writeFileSync(path, JSON.stringify({ bounds: { x: 1, y: 2, width: 0 } }), "utf8");
    expect(fileOverlayStateStore(path).load()).toEqual({});
  });
});
