import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Phase 16 encryption at rest (AES-256-GCM) for values that must stay
 * readable by the service but unreadable in a database dump: TOTP MFA
 * secrets and driver bank account numbers.
 *
 * Format: `v1:<base64 iv>:<base64 auth tag>:<base64 ciphertext>`.
 * The key comes from ENCRYPTION_KEY (64 hex chars or base64 of 32
 * bytes). Production without a key refuses to boot; dev/test fall
 * back to an ephemeral key with a loud warning, matching the JWT
 * dev-fallback precedent — never for production.
 *
 * Legacy plaintext values (no `v1:` prefix) still decrypt via
 * decryptMaybe so rows written before Phase 16 keep working; they
 * are re-encrypted opportunistically on the next write that touches
 * them (MFA enable, driver re-registration). A bulk re-encryption
 * pass over existing rows is a documented ops task, not done here
 * because there is no production data yet.
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    const raw = process.env.ENCRYPTION_KEY;
    if (raw) {
      const fromHex = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : null;
      const fromB64 = !fromHex ? Buffer.from(raw, 'base64') : null;
      const key = fromHex ?? fromB64;
      if (!key || key.length !== 32) {
        throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64)');
      }
      this.key = key;
    } else if (process.env.NODE_ENV === 'production') {
      throw new Error('ENCRYPTION_KEY is required in production');
    } else {
      // eslint-disable-next-line no-console
      console.warn('[crypto] ENCRYPTION_KEY not set — using an ephemeral key (DEV ONLY). Values encrypted now will not decrypt after a restart.');
      this.key = randomBytes(32);
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  decrypt(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Unsupported ciphertext format');
    }
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  }

  /** Null-safe, legacy-aware read: ciphertext decrypts, old plaintext passes through. */
  decryptMaybe(value: string | null): string | null {
    if (value === null) return null;
    if (value.startsWith('v1:')) return this.decrypt(value);
    return value;
  }
}
