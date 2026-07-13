import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findBannedPatterns, runBannedPatternsCli, scanContent } from "./check-banned-patterns.js";

// Banned words are assembled by concatenation everywhere in this file so the
// scanner cannot trip over its own test suite.
const TO_DO = "TO" + "DO";
const FIX_ME = "FIX" + "ME";
const H_ACK = "HA" + "CK";
const X_X_X = "XX" + "X";
const STU_B = "st" + "ub";
const PLACE_HOLDER = "place" + "holder";
const NOT_IMPLEMENTED = "not " + "implemented";
const UN_IMPLEMENTED = "un" + "implemented";

describe("scanContent", () => {
  it("flags every banned marker with its line number", () => {
    const content = [
      "const a = 1;",
      `// ${TO_DO}: fix this later`,
      `// ${FIX_ME} broken`,
      `/* ${H_ACK} */`,
      `// ${X_X_X} revisit`,
      `throw new Error("${UN_IMPLEMENTED}");`,
      `const x = "${PLACE_HOLDER}";`,
      `// this is ${STU_B}bed out`,
      `// ${NOT_IMPLEMENTED} yet`,
    ].join("\n");
    const hits = scanContent(content);
    expect(hits.map((h) => h.line)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("does not flag clean code, including words containing marker substrings", () => {
    const content = [
      "const stubbornness = 1; // 'stubborn' must not match the st-ub marker",
      "const hackathonResults = 2; // 'hackathon' is not a marker",
      "const today = new Date();",
      "const fixed = true;",
    ].join("\n");
    expect(scanContent(content)).toEqual([]);
  });

  it("matches markers case-insensitively", () => {
    expect(scanContent(`// ${TO_DO.toLowerCase()}: thing`).length).toBe(1);
    expect(scanContent(`// ${FIX_ME.toLowerCase()}`).length).toBe(1);
  });

  it("reports EVERY marker on a line, not just the first", () => {
    const hits = scanContent(`// ${TO_DO}: also a ${H_ACK} here`);
    expect(hits.length).toBe(2);
    expect(hits.every((h) => h.line === 1)).toBe(true);
  });

  it("defeats zero-width-character evasion inside a marker", () => {
    // Built from escapes so this source file itself contains no literal marker.
    const evaded = "TO" + "​" + "DO";
    expect(scanContent(`// ${evaded}: sneaky`).length).toBe(1);
  });

  it("defeats NFKC-normalizable homoglyph/ligature evasion", () => {
    const ligature = "ﬁ" + "xme"; // U+FB01 (fi ligature) normalizes to the marker
    expect(scanContent(`// ${ligature} later`).length).toBe(1);
  });

  it("bans test-double identifiers in PRODUCT code (isTest=false)", () => {
    const fakeWord = "fa" + "ke";
    const mockWord = "mo" + "ck";
    expect(scanContent(`class ${fakeWord}OllamaClient {}`, false).length).toBe(1);
    expect(scanContent(`const ${mockWord}Client = 1;`, false).length).toBe(1);
  });

  it("permits test-double identifiers in TEST files (isTest=true) but still bans markers", () => {
    const fakeWord = "fa" + "ke";
    expect(scanContent(`class ${fakeWord}Server {}`, true).length).toBe(0);
    expect(scanContent(`// ${TO_DO} in a test`, true).length).toBe(1);
  });

  it("does NOT ban the bare word 'double' (primitive type / common English)", () => {
    expect(scanContent("const doubled = x * 2; // double the rate", false)).toEqual([]);
  });
});

describe("findBannedPatterns (directory walk)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lodestar-banned-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("finds violations in source files and reports file + line", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "clean.ts"), "export const a = 1;\n");
    writeFileSync(join(dir, "src", "dirty.ts"), `export const b = 2;\n// ${TO_DO}: later\n`);
    const hits = findBannedPatterns(dir);
    expect(hits.length).toBe(1);
    expect(hits[0]?.file.replaceAll("\\", "/")).toContain("src/dirty.ts");
    expect(hits[0]?.line).toBe(2);
  });

  it("skips node_modules, dist, and test fixtures", () => {
    for (const sub of ["node_modules/pkg", "dist", "test/fixtures/journal"]) {
      mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(join(dir, sub, "f.ts"), `// ${FIX_ME}\n`);
    }
    expect(findBannedPatterns(dir)).toEqual([]);
  });

  it("does NOT treat 'latest/fixtures' as a fixture path (segment-anchored)", () => {
    mkdirSync(join(dir, "src", "latest", "fixtures"), { recursive: true });
    writeFileSync(join(dir, "src", "latest", "fixtures", "real.ts"), `// ${TO_DO}\n`);
    const hits = findBannedPatterns(dir);
    expect(hits.length).toBe(1);
    expect(hits[0]?.file.replaceAll("\\", "/")).toContain("latest/fixtures/real.ts");
  });

  it("scans .test.ts files for markers (they are banned even in tests)", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "thing.test.ts"), `// ${TO_DO} in a test file\n`);
    const hits = findBannedPatterns(dir);
    expect(hits.length).toBe(1);
    expect(hits[0]?.file.replaceAll("\\", "/")).toContain("thing.test.ts");
  });

  it("permits test-double vocabulary in .test.ts and .spec.ts files but not product files", () => {
    mkdirSync(join(dir, "e2e"), { recursive: true });
    const fakeWord = "fa" + "ke";
    writeFileSync(join(dir, "e2e", "boot.spec.ts"), `// uses a ${fakeWord} backend\n`);
    writeFileSync(join(dir, "e2e", "unit.test.ts"), `// uses a ${fakeWord} backend\n`);
    expect(findBannedPatterns(dir)).toEqual([]);
    // But a product file with the same word is flagged.
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "prod.ts"), `const ${fakeWord}Client = 1;\n`);
    expect(findBannedPatterns(dir).length).toBe(1);
  });

  it("skips markdown and non-source files", () => {
    writeFileSync(join(dir, "notes.md"), `${TO_DO} list\n`);
    writeFileSync(join(dir, "data.json"), `{"note": "${TO_DO}"}\n`);
    expect(findBannedPatterns(dir)).toEqual([]);
  });

  it("scans .ts, .tsx, .js, .mjs, .py and .sql files", () => {
    for (const [name, comment] of [
      ["a.ts", `// ${TO_DO}`],
      ["b.tsx", `// ${TO_DO}`],
      ["c.js", `// ${TO_DO}`],
      ["d.mjs", `// ${TO_DO}`],
      ["e.py", `# ${TO_DO}`],
      ["f.sql", `-- ${TO_DO}`],
    ] as const) {
      writeFileSync(join(dir, name), `${comment}\n`);
    }
    expect(findBannedPatterns(dir).length).toBe(6);
  });
});

describe("runBannedPatternsCli", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lodestar-banned-cli-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns exit code 0 and reports clean for a marker-free tree", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "clean.ts"), "export const a = 1;\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(runBannedPatternsCli(dir)).toBe(0);
    expect(log).toHaveBeenCalledWith("banned-patterns: clean");
  });

  it("returns exit code 1 and prints each hit when markers are present", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "dirty.ts"), `export const b = 2;\n// ${TO_DO}: later\n`);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(runBannedPatternsCli(dir)).toBe(1);
    expect(err).toHaveBeenCalled();
    expect(err.mock.calls.some(([m]) => String(m).includes("banned marker"))).toBe(true);
  });
});
