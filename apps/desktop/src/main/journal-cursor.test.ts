import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileJournalCursorStore } from "./journal-cursor.js";

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lodestar-cursor-"));
  path = join(dir, "journal-cursor.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("fileJournalCursorStore", () => {
  it("returns undefined when no cursor file exists", () => {
    expect(fileJournalCursorStore(path).load()).toBeUndefined();
  });

  it("round-trips a saved cursor", () => {
    const store = fileJournalCursorStore(path);
    store.save({ file: "Journal.2025-06-01T120000.01.log", offset: 4096 });
    expect(fileJournalCursorStore(path).load()).toEqual({
      file: "Journal.2025-06-01T120000.01.log",
      offset: 4096,
    });
  });

  it("ignores a corrupt or malformed cursor file", () => {
    writeFileSync(path, "{ not json", "utf8");
    expect(fileJournalCursorStore(path).load()).toBeUndefined();
    writeFileSync(path, JSON.stringify({ file: 42, offset: "nope" }), "utf8");
    expect(fileJournalCursorStore(path).load()).toBeUndefined();
    writeFileSync(path, JSON.stringify({ file: "x", offset: -5 }), "utf8");
    expect(fileJournalCursorStore(path).load()).toBeUndefined();
  });
});
