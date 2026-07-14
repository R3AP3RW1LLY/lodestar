import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, applyMigrations, MIGRATIONS } from "@lodestar/data";
import type { Db } from "@lodestar/data";
import { parseCsv } from "@lodestar/core";
import { createAnalyticsExporter } from "./analytics-export.js";

let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
  applyMigrations(db, MIGRATIONS);
  db.prepare(
    `INSERT INTO sessions (id, started_at, ended_at, ship, system, ring, tons_refined,
       credits_earned, limpets_launched, status)
     VALUES (1, '2025-06-01T12:00:00Z', '2025-06-01T13:00:00Z', 'Python', 'Paesia', 'Paesia 2 A Ring', 30, 30000000, 40, 'ended')`,
  ).run();
  db.prepare(
    "INSERT INTO refinements (session_id, timestamp, commodity, tons) VALUES (1, '2025-06-01T12:10:00Z', 'painite', 20)",
  ).run();
  db.prepare(
    `INSERT INTO prospects (session_id, timestamp, content, remaining_pct, materials, verdict, acted_on)
     VALUES (1, '2025-06-01T12:05:00Z', '$AsteroidMaterialContent_High;', 100, '[]', 'MINE', 1)`,
  ).run();
});
afterEach(() => db.close());

describe("createAnalyticsExporter", () => {
  it("writes the chosen dataset as CSV and returns the path", async () => {
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const exporter = createAnalyticsExporter({
      db,
      showSaveDialog: () => Promise.resolve({ canceled: false, filePath: "D:/out/sessions.csv" }),
      writeFile,
    });
    const result = await exporter.export("sessions", false);
    expect(result).toEqual({ ok: true, path: "D:/out/sessions.csv" });
    expect(writeFile).toHaveBeenCalledOnce();
    const [path, content] = writeFile.mock.calls[0] as [string, string];
    expect(path).toBe("D:/out/sessions.csv");
    const parsed = parseCsv(content);
    expect(parsed[0]?.[0]).toBe("id"); // header
    expect(parsed[1]?.[0]).toBe("1"); // the one session
  });

  it("does nothing and reports cancel when the dialog is dismissed", async () => {
    const writeFile = vi.fn();
    const exporter = createAnalyticsExporter({
      db,
      showSaveDialog: () => Promise.resolve({ canceled: true }),
      writeFile,
    });
    expect(await exporter.export("sessions", false)).toEqual({ ok: false, path: null });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("exports refinements and prospects with a BOM when asked", async () => {
    const captured: Record<string, string> = {};
    const exporter = createAnalyticsExporter({
      db,
      showSaveDialog: (name) => Promise.resolve({ canceled: false, filePath: `D:/out/${name}` }),
      writeFile: (path, content) => {
        captured[path] = content;
        return Promise.resolve();
      },
    });
    await exporter.export("refinements", true);
    await exporter.export("prospects", true);
    expect(captured["D:/out/lodestar-refinements.csv"]?.charCodeAt(0)).toBe(0xfeff);
    expect(parseCsv(captured["D:/out/lodestar-refinements.csv"] ?? "")[1]).toEqual([
      "1",
      "2025-06-01T12:10:00Z",
      "painite",
      "20",
    ]);
    expect(parseCsv(captured["D:/out/lodestar-prospects.csv"] ?? "")[0]?.[0]).toBe("id");
  });
});
