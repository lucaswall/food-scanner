import crypto from "node:crypto";
import { getRequiredEnv } from "@/lib/env";

const ALGORITHM = "aes-256-gcm";

/** Current ciphertext version byte. Prepended to every encrypted blob. */
const VERSION = 0x01;

/**
 * Static info label for HKDF derivation. Changing this value invalidates all
 * existing ciphertexts — treat it as part of the key schedule.
 */
const HKDF_INFO = Buffer.from("food-scanner-health-token-v1");

/**
 * Fixed zero salt for HKDF. The IKM is already high-entropy (a 32-byte
 * random key from env), so a zero salt is acceptable per RFC 5869 §3.1.
 */
const HKDF_SALT = Buffer.alloc(32, 0);

/**
 * Typed error thrown by decryptToken when the ciphertext is unreadable.
 * Covers: unknown/missing version byte, GCM authentication failure, truncated data.
 * Callers should treat this as "token absent" and force re-authentication.
 */
export class TokenDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenDecryptionError";
  }
}

/**
 * AES-256-GCM key, derived once from HEALTH_TOKEN_ENCRYPTION_KEY via HKDF-SHA256
 * and cached for the module lifetime. Lazy initialization defers the env read to
 * the first encrypt/decrypt call so tests that mock this module are not affected
 * by the missing env var at import time.
 *
 * The key is still computed only once (not per-call) — per-call KDF would be too
 * slow on the hot path.
 */
let _cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (!_cachedKey) {
    const rawKey = Buffer.from(getRequiredEnv("HEALTH_TOKEN_ENCRYPTION_KEY"), "base64");
    _cachedKey = Buffer.from(crypto.hkdfSync("sha256", rawKey, HKDF_SALT, HKDF_INFO, 32));
  }
  return _cachedKey;
}

/**
 * Boot-time validation: the configured key must base64-decode to exactly 32 bytes
 * (AES-256 IKM). A short or non-base64 value would silently yield a weak/degenerate key,
 * so fail fast at startup rather than at first encrypt (P2-7). Call from instrumentation.
 */
export function validateEncryptionKey(): void {
  const raw = Buffer.from(getRequiredEnv("HEALTH_TOKEN_ENCRYPTION_KEY"), "base64");
  if (raw.length !== 32) {
    throw new Error(
      `HEALTH_TOKEN_ENCRYPTION_KEY must base64-decode to exactly 32 bytes (got ${raw.length}). ` +
        "Generate one with: openssl rand -base64 32",
    );
  }
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * Ciphertext layout: version(1) | iv(12) | tag(16) | cipherdata(N)
 * The version prefix enables graceful rejection of old-format blobs on decryption.
 */
export function encryptToken(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // version(1) | iv(12) | tag(16) | data
  return Buffer.concat([Buffer.from([VERSION]), iv, tag, encrypted]).toString("base64");
}

/**
 * Decrypts a ciphertext produced by encryptToken.
 *
 * @throws {TokenDecryptionError} if the version byte is missing/unknown, the
 *   buffer is too short, or GCM authentication fails. Callers should treat this
 *   as "no token present" and prompt the user to re-link Google Health.
 */
export function decryptToken(ciphertext: string): string {
  const buf = Buffer.from(ciphertext, "base64");

  // Minimum: version(1) + iv(12) + tag(16) = 29 bytes
  if (buf.length < 29) {
    throw new TokenDecryptionError(
      `Token ciphertext too short (${buf.length} bytes); expected at least 29`,
    );
  }

  const version = buf[0];
  if (version !== VERSION) {
    throw new TokenDecryptionError(
      `Unknown token format version: 0x${version.toString(16).padStart(2, "0")}`,
    );
  }

  // version(1) | iv(12) | tag(16) | data
  const iv = buf.subarray(1, 13);
  const tag = buf.subarray(13, 29);
  const encrypted = buf.subarray(29);

  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw new TokenDecryptionError("Token decryption failed: GCM authentication error");
  }
}
