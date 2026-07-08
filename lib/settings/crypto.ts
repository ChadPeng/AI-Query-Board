/**
 * At-rest encryption for Secret Settings (docs/adr/0005). Moving credentials into
 * the state DB is a security regression versus .env unless they're encrypted, so
 * secret settings are sealed with AES-256-GCM (authenticated: tampering fails to
 * decrypt). The key is derived from SETTINGS_ENCRYPTION_KEY, or AUTH_SECRET as a
 * fallback — both stay in .env, so a leaked DB dump alone can't reveal secrets.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

const PREFIX = "enc:v1:"; // marks a stored value as encrypted (vs a plain override)
const IV_LEN = 12; // GCM standard nonce length
const TAG_LEN = 16; // GCM auth tag length

/** Derive a 32-byte AES key from a secret string (sha256). Deterministic. */
export function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function envKey(): Buffer {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!raw) {
    throw new Error("未設定 SETTINGS_ENCRYPTION_KEY 或 AUTH_SECRET，無法加密祕密設定");
  }
  return deriveKey(raw);
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}

/** Encrypt plaintext → `enc:v1:<base64(iv|tag|ciphertext)>`. */
export function encryptSecret(plain: string, key: Buffer = envKey()): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a value produced by encryptSecret. Throws on a wrong key or tampering. */
export function decryptSecret(stored: string, key: Buffer = envKey()): string {
  if (!isEncrypted(stored)) throw new Error("值未加密");
  const buf = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
