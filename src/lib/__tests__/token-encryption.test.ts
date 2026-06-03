import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub HEALTH_TOKEN_ENCRYPTION_KEY before any module import (key derived at module scope)
const TEST_KEY_B64 = Buffer.alloc(32, 0xab).toString("base64"); // deterministic 32-byte key
vi.stubEnv("HEALTH_TOKEN_ENCRYPTION_KEY", TEST_KEY_B64);

describe("token encryption (HKDF-SHA256 + version prefix)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("round-trip: encryptToken/decryptToken recovers original plaintext", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    const plaintext = "my-secret-access-token";
    expect(decryptToken(encryptToken(plaintext))).toBe(plaintext);
  });

  it("ciphertext carries version prefix byte 0x01 as the first byte", async () => {
    const { encryptToken } = await import("@/lib/token-encryption");
    const buf = Buffer.from(encryptToken("test-token"), "base64");
    expect(buf[0]).toBe(0x01);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const { encryptToken } = await import("@/lib/token-encryption");
    expect(encryptToken("same-token")).not.toBe(encryptToken("same-token"));
  });

  it("decryptToken throws TokenDecryptionError for unversioned (legacy) blob — version byte 0x00", async () => {
    const { decryptToken, TokenDecryptionError } = await import("@/lib/token-encryption");
    // Simulate old format: iv(12)|tag(16)|data — first byte is part of IV, not a version tag
    const legacyBuf = Buffer.alloc(40, 0xcc);
    legacyBuf[0] = 0x00; // any value != 0x01 is unknown version
    expect(() => decryptToken(legacyBuf.toString("base64"))).toThrow(TokenDecryptionError);
  });

  it("decryptToken throws TokenDecryptionError for a blob with unknown version byte (0x02)", async () => {
    const { decryptToken, TokenDecryptionError } = await import("@/lib/token-encryption");
    const unknownVersionBuf = Buffer.alloc(40, 0xcc);
    unknownVersionBuf[0] = 0x02; // future/unknown version
    expect(() => decryptToken(unknownVersionBuf.toString("base64"))).toThrow(TokenDecryptionError);
  });

  it("decryptToken throws TokenDecryptionError on GCM authentication failure (tampered ciphertext)", async () => {
    const { encryptToken, decryptToken, TokenDecryptionError } = await import("@/lib/token-encryption");
    const enc = encryptToken("original-token");
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0xff; // flip last byte to corrupt authentication tag / data
    expect(() => decryptToken(buf.toString("base64"))).toThrow(TokenDecryptionError);
  });

  it("TokenDecryptionError is distinguishable from generic Error", async () => {
    const { decryptToken, TokenDecryptionError } = await import("@/lib/token-encryption");
    const badBuf = Buffer.alloc(40, 0x00); // version 0x00 = unknown
    try {
      decryptToken(badBuf.toString("base64"));
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(TokenDecryptionError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("encryptToken/decryptToken handles empty string plaintext", async () => {
    const { encryptToken, decryptToken } = await import("@/lib/token-encryption");
    expect(decryptToken(encryptToken(""))).toBe("");
  });
});
