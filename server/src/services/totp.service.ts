import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { prisma } from '../config/prisma';

/** RFC 6238 time-based one-time codes, as used by Google Authenticator, Authy, Microsoft Authenticator. */
const STEP_SECONDS = 30;
const DIGITS = 6;
const ISSUER = 'HomeExpens';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string) {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/[\s=]/g, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const currentStep = (now = Date.now()) => Math.floor(now / 1000 / STEP_SECONDS);

/** The code an authenticator app shows for this secret at the given 30-second step. */
export function totpCode(secret: string, step = currentStep()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** Accepts the current code or one step either side (clock drift). Returns the matched step, or null. */
export function matchTotp(secret: string, code: string, lastStep: number | null) {
  const now = currentStep();
  for (const step of [now - 1, now, now + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (totpCode(secret, step) === code) return step;
  }
  return null;
}

// Secrets are encrypted at rest with a key derived from JWT_SECRET (rotating it requires re-enrolling 2FA).
const key = () => Buffer.from(hkdfSync('sha256', env.JWT_SECRET, 'home-expens', 'totp-secret', 32));

export function encryptSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(stored: string) {
  const [version, iv, tag, data] = stored.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unknown 2FA secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

/** Creates (or replaces) a user's authenticator secret. Returns what to type or scan into the app. */
export async function enrollTotp(userId: string) {
  const secret = base32Encode(randomBytes(20));
  const user = await prisma.user.update({ where: { id: userId }, data: { totpSecret: encryptSecret(secret), totpLastStep: null }, select: { email: true } });
  const label = encodeURIComponent(`${ISSUER}:${user.email}`);
  return { secret, uri: `otpauth://totp/${label}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}` };
}
