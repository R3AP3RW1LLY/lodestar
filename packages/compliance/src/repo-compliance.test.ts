/**
 * The real-tree compliance scans (Step 0.11). These run every scanner over the
 * actual repository and MUST come back clean — this is the non-lint,
 * non-disable-able enforcement layer. A violation here fails `pnpm compliance`
 * and blocks the merge. The scanners themselves are unit-proven in
 * scanners.test.ts (each catches a violating fixture).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  DENIED_AI_HOSTS,
  INSTALL_HOSTS,
  RUNTIME_ALLOWLIST,
  RUNTIME_HOSTS,
  createGateway,
  guardUrl,
} from "@lodestar/integrations";
import { findBannedPatterns } from "@lodestar/scripts/banned-patterns";
import {
  findAiVendorDeps,
  findDisallowedHostLiterals,
  findRawSocketUsage,
  findSecretLiterals,
  findSkippedTests,
  scanTree,
} from "./scanners.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const SRC_EXT = new Set([".ts", ".tsx", ".js", ".cjs", ".mjs"]);
const SECRET_SCAN_EXT = new Set([".ts", ".tsx", ".js", ".cjs", ".mjs", ".json", ".yml", ".yaml"]);

// Product URL literals that legitimately name a non-connecting host (schemas,
// XML namespaces). Extend consciously — never add an AI/data host here.
const KNOWN_SAFE_HOSTS = new Set([
  "json.schemastore.org",
  "turbo.build",
  "www.w3.org",
  "eslint.org",
  "turborepo.dev",
]);

// Test fixtures intentionally embed secret-shaped strings to prove refusal/
// redaction. They MUST carry one of these sentinels so the secret scan can tell
// them from a real leak. A real key never contains these tokens.
const FIXTURE_SENTINEL =
  /(fixture|should-not|do-not|secret-\d|LIVE-e2e|LIVE-do|not-echo|not-leak)/i;

describe("compliance: no cloud AI", () => {
  it("no AI/ML vendor SDK appears in the pnpm lockfile", () => {
    const lock = readFileSync(join(REPO_ROOT, "pnpm-lock.yaml"), "utf8");
    expect(findAiVendorDeps(lock)).toEqual([]);
  });

  it("no denied AI/ML inference host is on any allowlist, and no runtime host matches an AI keyword", () => {
    for (const host of DENIED_AI_HOSTS) {
      expect(RUNTIME_ALLOWLIST.has(host)).toBe(false);
    }
    const aiKeyword =
      /(openai|anthropic|claude|gpt|cohere|mistral|bedrock|vertex|generativelanguage|groq|together|perplexity|deepseek|openrouter)/i;
    for (const host of RUNTIME_HOSTS) {
      expect(aiKeyword.test(host), `runtime host looks AI-related: ${host}`).toBe(false);
    }
  });

  it("pins the exact allowlist contents so any new host requires a visible, conscious diff (§5.4)", () => {
    expect([...RUNTIME_HOSTS]).toEqual([
      "www.edsm.net",
      "spansh.co.uk",
      "inara.cz",
      "eddn.edcd.io",
      "auth.frontierstore.net",
      "companion.orerve.net",
      "discord.com",
    ]);
    expect([...INSTALL_HOSTS]).toEqual([
      "github.com",
      "objects.githubusercontent.com",
      "release-assets.githubusercontent.com",
      "huggingface.co",
      "registry.ollama.ai",
      "ollama.com",
      "pypi.org",
      "files.pythonhosted.org",
    ]);
  });

  it("the gateway refuses every denied AI host AND an unknown constructed host, without calling the transport", async () => {
    const fetchFn = () => {
      throw new Error("transport must not be reached for a refused host");
    };
    const gw = createGateway({ fetchFn });
    for (const host of [...DENIED_AI_HOSTS, "totally-unknown-" + "host.example"]) {
      const r = await gw.request(`https://${host}/x`);
      expect(r.ok, `expected refusal for ${host}`).toBe(false);
    }
  });
});

describe("compliance: egress confinement (source scan)", () => {
  const allowedHosts = new Set<string>([...RUNTIME_HOSTS, ...INSTALL_HOSTS, ...KNOWN_SAFE_HOSTS]);

  it("no product source names a non-allowlisted host in a URL literal", () => {
    const findings = ["packages", "apps", "services"].flatMap((group) =>
      scanTree(join(REPO_ROOT, group), { extensions: SRC_EXT }, (c) =>
        findDisallowedHostLiterals(c, allowedHosts),
      ),
    );
    expect(findings, JSON.stringify(findings)).toEqual([]);
  });

  it("no product source uses raw sockets/fetch outside the sanctioned gateway/downloader", () => {
    const skipPaths = ["packages/integrations/src/gateway", "packages/integrations/src/downloader"];
    const findings = ["packages", "apps", "services"].flatMap((group) =>
      scanTree(join(REPO_ROOT, group), { extensions: SRC_EXT, skipPaths }, findRawSocketUsage),
    );
    expect(findings, JSON.stringify(findings)).toEqual([]);
  });

  it("guardUrl rejects api.openai.com and accepts an allowlisted host", () => {
    expect(guardUrl("https://api.openai.com/v1", RUNTIME_ALLOWLIST).ok).toBe(false);
    expect(guardUrl("https://www.edsm.net/api", RUNTIME_ALLOWLIST).ok).toBe(true);
  });
});

describe("compliance: no secrets in tracked source (INCLUDING tests)", () => {
  it("no real secret-shaped literal appears anywhere — test fixtures must carry a sentinel", () => {
    const raw = ["packages", "apps", "services"].flatMap((group) =>
      scanTree(
        join(REPO_ROOT, group),
        { extensions: SECRET_SCAN_EXT, includeTests: true },
        findSecretLiterals,
      ),
    );
    const realLeaks = raw.filter((f) => !FIXTURE_SENTINEL.test(f.match));
    expect(realLeaks, JSON.stringify(realLeaks)).toEqual([]);
  });
});

describe("compliance: the suite cannot be silently weakened", () => {
  it("no compliance or gateway test is skipped/focused (.skip/.only/xit)", () => {
    const findings = [
      ...scanTree(
        join(REPO_ROOT, "packages", "compliance"),
        { extensions: SRC_EXT, includeTests: true },
        findSkippedTests,
      ),
      ...scanTree(
        join(REPO_ROOT, "packages", "integrations"),
        { extensions: SRC_EXT, includeTests: true },
        findSkippedTests,
      ),
    ];
    expect(findings, JSON.stringify(findings)).toEqual([]);
  });

  it("meta-integrity: the real-tree scan still contains its core assertions", () => {
    const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
    for (const marker of [
      "no AI/ML vendor SDK appears in the pnpm lockfile",
      "pins the exact allowlist contents",
      "no product source uses raw sockets/fetch",
      "no real secret-shaped literal appears anywhere",
    ]) {
      expect(self.includes(marker), `missing compliance assertion: ${marker}`).toBe(true);
    }
  });
});

describe("compliance: no work-deferred markers", () => {
  it("the whole tree is free of the banned marker set", () => {
    expect(findBannedPatterns(REPO_ROOT)).toEqual([]);
  });
});
