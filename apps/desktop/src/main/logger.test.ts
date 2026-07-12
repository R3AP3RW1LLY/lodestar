import { describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Writable } from "node:stream";
import { createLogger, createRollingDestination, REDACT_PATHS } from "./logger.js";

function captureStream(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      chunks.push(chunk.toString("utf8"));
      cb();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

describe("logger", () => {
  it("implements every shared LogLevel and a child()", () => {
    const cap = captureStream();
    const log = createLogger({ destination: cap.stream, level: "trace" });
    log.trace("t");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    log.fatal("f");
    const child = log.child({ module: "sub" });
    child.info("from-child");
    const lines = cap.lines();
    expect(lines.map((l) => l["msg"])).toContain("from-child");
    expect(lines.at(-1)?.["module"]).toBe("sub");
  });

  it("redacts secret-shaped fields (top-level and one level deep)", () => {
    const cap = captureStream();
    const log = createLogger({ destination: cap.stream });
    log.info("auth", {
      apiKey: "sk-secret-123",
      token: "ghp_secret",
      webhookUrl: "https://discord.com/api/webhooks/111/aaa-bbb",
      nested: { password: "hunter2", accessToken: "tok" },
      safe: "keep-me",
    });
    const line = cap.lines()[0];
    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain("sk-secret-123");
    expect(serialized).not.toContain("ghp_secret");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("discord.com/api/webhooks");
    expect(serialized).toContain("keep-me");
    expect(REDACT_PATHS.length).toBeGreaterThan(4);
  });

  it("redacts snake_case OAuth secrets nested deep (error.response.data.access_token)", () => {
    const cap = captureStream();
    const log = createLogger({ destination: cap.stream });
    log.error("capi.token-exchange-failed", {
      error: { response: { data: { access_token: "at-LEAK", refresh_token: "rt-LEAK" } } },
      headers: { Authorization: "Bearer bearer-LEAK" },
    });
    const serialized = JSON.stringify(cap.lines()[0]);
    expect(serialized).not.toContain("at-LEAK");
    expect(serialized).not.toContain("rt-LEAK");
    expect(serialized).not.toContain("bearer-LEAK");
  });

  it("rolls to multiple files when the size limit is exceeded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lodestar-log-"));
    try {
      const dest = await createRollingDestination(dir, { size: "1k", mkdir: true });
      await once(dest, "ready");
      // Each flushed write exceeds the 1k limit, so pino-roll rolls per write.
      for (let i = 0; i < 6; i++) {
        dest.write(`${"y".repeat(1500)}\n`);
        await new Promise<void>((resolve) => {
          dest.flush(resolve);
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      const files = readdirSync(dir).filter((f) => f.endsWith(".log"));
      expect(files.length).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("end-to-end: the real createLogger→createRollingDestination pipeline redacts secrets on disk across rolled files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "lodestar-log-e2e-"));
    try {
      const dest = await createRollingDestination(dir, { size: "1k" });
      const log = createLogger({ destination: dest });
      await once(dest, "ready");
      for (let i = 0; i < 8; i++) {
        log.info("capi.token.stored", {
          apiKey: `sk-LIVE-SECRET-${String(i)}`,
          filler: "z".repeat(1500),
        });
        await new Promise<void>((resolve) => {
          dest.flush(resolve);
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
      const files = readdirSync(dir).filter((f) => f.endsWith(".log"));
      expect(files.length).toBeGreaterThanOrEqual(2);
      const content = files.map((f) => readFileSync(join(dir, f), "utf8")).join("");
      expect(content).not.toContain("sk-LIVE-SECRET");
      expect(content).toContain("[redacted]");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
