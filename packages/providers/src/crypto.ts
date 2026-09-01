import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function key(): Buffer {
  const raw = process.env.CREDENTIALS_KEY;
  if (!raw) throw new Error('Falta CREDENTIALS_KEY (base64 de 32 bytes)');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(`CREDENTIALS_KEY debe decodificar a 32 bytes, no ${buf.length}`);
  }
  return buf;
}

/**
 * Cifra las credenciales de un proveedor antes de guardarlas en PostgreSQL.
 * Formato: base64(iv | authTag | ciphertext).
 */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key(), iv);
  const data = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), 'utf8')),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptJson<T>(payload: string): T {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + 16);
  const data = raw.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(out.toString('utf8')) as T;
}
