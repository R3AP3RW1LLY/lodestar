import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLASSIFICATION,
  checkDependencyDirection,
  importSpecifiers,
  runDependencyDirectionCli,
} from "./check-dependency-direction.js";

function writeSource(root: string, dir: string, name: string, body: string): void {
  const pkgDir = join(root, dir);
  mkdirSync(join(pkgDir, "src"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name, version: "0.0.0", dependencies: {} }),
  );
  writeFileSync(join(pkgDir, "src", "index.ts"), body);
}

function makePackage(
  root: string,
  dir: string,
  name: string,
  deps: string[],
  imports: string[] = [],
): void {
  const pkgDir = join(root, dir);
  mkdirSync(join(pkgDir, "src"), { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name,
      version: "0.0.0",
      dependencies: Object.fromEntries(deps.map((d) => [d, "workspace:*"])),
    }),
  );
  const importLines = imports.map((s, i) => `import * as m${String(i)} from "${s}";`).join("\n");
  writeFileSync(join(pkgDir, "src", "index.ts"), `${importLines}\nexport const x = 1;\n`);
}

describe("checkDependencyDirection", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lodestar-deps-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("passes a compliant layout (core -> intelligence/data/shared; features -> core)", () => {
    makePackage(root, "packages/shared", "@lodestar/shared", []);
    makePackage(root, "packages/data", "@lodestar/data", ["@lodestar/shared"]);
    makePackage(root, "packages/intelligence", "@lodestar/intelligence", ["@lodestar/shared"]);
    makePackage(root, "packages/core", "@lodestar/core", [
      "@lodestar/intelligence",
      "@lodestar/data",
      "@lodestar/shared",
    ]);
    makePackage(root, "packages/ai", "@lodestar/ai", ["@lodestar/core", "@lodestar/shared"]);
    expect(checkDependencyDirection(root)).toEqual([]);
  });

  it("fails intelligence importing ai (declared dependency)", () => {
    makePackage(root, "packages/ai", "@lodestar/ai", []);
    makePackage(root, "packages/intelligence", "@lodestar/intelligence", ["@lodestar/ai"]);
    const violations = checkDependencyDirection(root);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("@lodestar/intelligence");
    expect(violations[0]).toContain("@lodestar/ai");
  });

  it("fails ai importing voice (the LLM-input firewall), even via undeclared source import", () => {
    makePackage(root, "packages/voice", "@lodestar/voice", []);
    makePackage(root, "packages/ai", "@lodestar/ai", [], ["@lodestar/voice"]);
    const violations = checkDependencyDirection(root);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("@lodestar/ai");
    expect(violations[0]).toContain("@lodestar/voice");
  });

  it("fails intelligence importing node built-ins (purity: no I/O)", () => {
    makePackage(root, "packages/intelligence", "@lodestar/intelligence", [], ["node:fs"]);
    const violations = checkDependencyDirection(root);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("node:fs");
  });

  it("fails an unclassified package", () => {
    makePackage(root, "packages/mystery", "@lodestar/mystery", []);
    const violations = checkDependencyDirection(root);
    expect(violations.length).toBe(1);
    expect(violations[0]).toContain("not classified");
  });

  it("fails a package importing the desktop app", () => {
    makePackage(root, "packages/core", "@lodestar/core", [], ["desktop"]);
    const violations = checkDependencyDirection(root);
    expect(violations.some((v) => v.includes("desktop"))).toBe(true);
  });

  it("test files are exempt from the direction check (test doubles live there)", () => {
    makePackage(root, "packages/voice", "@lodestar/voice", []);
    makePackage(root, "packages/ai", "@lodestar/ai", []);
    const testFile = join(root, "packages/ai/src/thing.test.ts");
    writeFileSync(testFile, `import * as v from "@lodestar/voice";\nexport const t = 1;\n`);
    expect(checkDependencyDirection(root)).toEqual([]);
  });

  it("catches a DYNAMIC import() firewall bypass (ai -> voice)", () => {
    makePackage(root, "packages/voice", "@lodestar/voice", []);
    writeSource(
      root,
      "packages/ai",
      "@lodestar/ai",
      `export const v = await import("@lodestar/voice");\n`,
    );
    const violations = checkDependencyDirection(root);
    expect(violations.some((v) => v.includes("@lodestar/voice"))).toBe(true);
  });

  it("catches a require() firewall bypass (ai -> voice)", () => {
    makePackage(root, "packages/voice", "@lodestar/voice", []);
    writeSource(root, "packages/ai", "@lodestar/ai", `const v = require("@lodestar/voice");\n`);
    const violations = checkDependencyDirection(root);
    expect(violations.some((v) => v.includes("@lodestar/voice"))).toBe(true);
  });

  it("catches a RELATIVE-PATH firewall bypass (ai -> ../../voice)", () => {
    makePackage(root, "packages/voice", "@lodestar/voice", []);
    writeSource(
      root,
      "packages/ai",
      "@lodestar/ai",
      `import { e } from "../../voice/src/emitter.js";\n`,
    );
    const violations = checkDependencyDirection(root);
    expect(violations.some((v) => v.includes("@lodestar/voice"))).toBe(true);
  });

  it("does NOT flag comment text that looks like an import", () => {
    makePackage(root, "packages/intelligence", "@lodestar/intelligence", []);
    writeSource(
      root,
      "packages/intelligence",
      "@lodestar/intelligence",
      `/** @example import fs from "node:fs"; import x from "@lodestar/ai"; */\nexport const x = 1;\n`,
    );
    expect(checkDependencyDirection(root)).toEqual([]);
  });

  it("does NOT flag a type-only node built-in import in a pure package (fully erased)", () => {
    makePackage(root, "packages/intelligence", "@lodestar/intelligence", []);
    writeSource(
      root,
      "packages/intelligence",
      "@lodestar/intelligence",
      `import type { Buffer } from "node:buffer";\nexport type B = Buffer;\n`,
    );
    expect(checkDependencyDirection(root)).toEqual([]);
  });

  it("firewall invariant: voice is transitively unreachable from ai in CLASSIFICATION", () => {
    const seen = new Set<string>();
    const queue = ["@lodestar/ai"];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || seen.has(current)) continue;
      seen.add(current);
      for (const dep of CLASSIFICATION[current] ?? []) {
        if (dep !== "*") queue.push(dep);
      }
    }
    expect(seen.has("@lodestar/voice")).toBe(false);
  });

  it("permits an intra-package relative import (resolves to no foreign package)", () => {
    makePackage(root, "packages/core", "@lodestar/core", []);
    writeSource(
      root,
      "packages/core",
      "@lodestar/core",
      `import { helper } from "./util/helper.js";\nexport const x = helper;\n`,
    );
    expect(checkDependencyDirection(root)).toEqual([]);
  });
});

describe("importSpecifiers", () => {
  it("captures `export ... from` re-exports (value and type-only)", () => {
    const refs = importSpecifiers(
      [`export { a } from "@lodestar/shared";`, `export type { T } from "@lodestar/data";`].join(
        "\n",
      ),
    );
    expect(refs).toContainEqual({ spec: "@lodestar/shared", typeOnly: false });
    expect(refs).toContainEqual({ spec: "@lodestar/data", typeOnly: true });
  });
});

describe("runDependencyDirectionCli", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "lodestar-deps-cli-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns exit code 2 when no pnpm-workspace.yaml marks the repo root", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(runDependencyDirectionCli(root)).toBe(2);
    expect(err.mock.calls.some(([m]) => String(m).includes("cannot locate repo root"))).toBe(true);
  });

  it("returns exit code 0 and reports clean for a compliant workspace", () => {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    makePackage(root, "packages/shared", "@lodestar/shared", []);
    makePackage(root, "packages/data", "@lodestar/data", ["@lodestar/shared"]);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(runDependencyDirectionCli(root)).toBe(0);
    expect(log.mock.calls.some(([m]) => String(m).includes("clean"))).toBe(true);
  });

  it("returns exit code 1 and prints each violation for a forbidden dependency", () => {
    writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
    makePackage(root, "packages/ai", "@lodestar/ai", []);
    makePackage(root, "packages/intelligence", "@lodestar/intelligence", ["@lodestar/ai"]);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(runDependencyDirectionCli(root)).toBe(1);
    expect(err.mock.calls.some(([m]) => String(m).includes("@lodestar/ai"))).toBe(true);
  });
});
