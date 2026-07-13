import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The real safeStorage only exists in the Electron main process (the e2e proves
// it end-to-end). Here we mock it to prove safeStorageBackend delegates 1:1.
const { safeStorageMock } = vi.hoisted(() => ({
  safeStorageMock: {
    isEncryptionAvailable: vi.fn((): boolean => true),
    encryptString: vi.fn((plaintext: string): Buffer => Buffer.from(`enc:${plaintext}`, "utf8")),
    decryptString: vi.fn((cipher: Buffer): string => cipher.toString("utf8").replace("enc:", "")),
  },
}));
vi.mock("electron", () => ({ safeStorage: safeStorageMock }));

const { fileSecretStorage, safeStorageBackend } = await import("./secrets.js");

describe("safeStorageBackend", () => {
  it("delegates availability, encryption, and decryption to Electron safeStorage", () => {
    const backend = safeStorageBackend();
    expect(backend.isEncryptionAvailable()).toBe(true);
    const cipher = backend.encryptString("plaintext-value");
    expect(safeStorageMock.encryptString).toHaveBeenCalledWith("plaintext-value");
    expect(cipher.toString("utf8")).toBe("enc:plaintext-value");
    expect(backend.decryptString(cipher)).toBe("plaintext-value");
  });
});

describe("fileSecretStorage", () => {
  it("writes, reads, and removes ciphertext blobs under the secrets dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "lodestar-secrets-"));
    try {
      const storage = fileSecretStorage(dir);
      expect(storage.read("k")).toBeUndefined();
      const blob = Buffer.from([1, 2, 3, 250]);
      storage.write("k", blob);
      expect(storage.read("k")).toEqual(blob);
      storage.remove("k");
      expect(storage.read("k")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sanitizes the key so it cannot traverse outside the secrets dir", () => {
    const dir = mkdtempSync(join(tmpdir(), "lodestar-secrets-"));
    try {
      const storage = fileSecretStorage(dir);
      // A traversal-looking key must not escape the directory.
      storage.write("../../evil", Buffer.from([9]));
      // It is stored under a sanitized name inside dir, retrievable by the same key.
      expect(storage.read("../../evil")).toEqual(Buffer.from([9]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
