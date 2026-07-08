import { describe, it, expect } from "vitest";
import { deriveKey, encryptSecret, decryptSecret, isEncrypted } from "./crypto";

const key = deriveKey("test-master-secret");

describe("secret encryption (AES-256-GCM)", () => {
  it("round-trips a value", () => {
    const enc = encryptSecret("s3cr3t-password", key);
    expect(decryptSecret(enc, key)).toBe("s3cr3t-password");
  });

  it("marks ciphertext with the enc prefix and never contains the plaintext", () => {
    const enc = encryptSecret("hunter2", key);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("hunter2");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("fails to decrypt with the wrong key", () => {
    const enc = encryptSecret("secret", key);
    expect(() => decryptSecret(enc, deriveKey("other-secret"))).toThrow();
  });

  it("fails to decrypt tampered ciphertext (authenticated)", () => {
    const enc = encryptSecret("secret", key);
    const tampered = enc.slice(0, -3) + (enc.endsWith("A") ? "B" : "A") + enc.slice(-2);
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it("rejects decrypting a non-encrypted value", () => {
    expect(() => decryptSecret("plain text", key)).toThrow();
  });
});
