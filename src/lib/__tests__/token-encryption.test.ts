import { describe, it, expect, vi } from "vitest";

vi.stubEnv("SESSION_SECRET", "a-test-secret-that-is-at-least-32-characters-long");

describe("token encryption", () => {
  it("encryptToken returns a different string than input", async () => {
    const { encryptToken } = await import("@/lib/token-encryption");
    const plaintext = "my-secret-access-token";
    const encrypted = encryptToken(plaintext);

    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.length).toBeGreaterThan(0);
  });

  it("decryptToken recovers the original plaintext", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    const plaintext = "my-secret-access-token-12345";
    const encrypted = encryptToken(plaintext);
    const decrypted = decryptToken(encrypted);

    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const { encryptToken } = await import("@/lib/token-encryption");
    const plaintext = "same-token";
    const encrypted1 = encryptToken(plaintext);
    const encrypted2 = encryptToken(plaintext);

    expect(encrypted1).not.toBe(encrypted2);
  });

  it("throws on tampered ciphertext", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    const encrypted = encryptToken("my-token");

    // Tamper with the ciphertext by changing a character
    const buf = Buffer.from(encrypted, "base64");
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64");

    expect(() => decryptToken(tampered)).toThrow();
  });

  it("throws on empty/invalid base64 input", async () => {
    const { decryptToken } = await import("@/lib/token-encryption");

    expect(() => decryptToken("not-valid-base64!!!")).toThrow();
  });
});
