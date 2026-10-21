import { randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

/**
 * Firebase Authentication emails the password reset link (from its own address, no mail account of ours).
 * Firebase only mails people it knows, so each account is mirrored there by email with a random password
 * nobody uses. The link opens our /reset-password page (the action URL set in the Firebase console), and
 * the new password is set in our database, never in Firebase.
 */
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

export const firebaseConfigured = () => Boolean(env.FIREBASE_API_KEY);

async function identity<T>(action: string, body: unknown, locale?: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const response = await fetch(`${IDENTITY}:${action}?key=${env.FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(locale ? { 'X-Firebase-Locale': locale } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const json = (await response.json().catch(() => null)) as (T & { error?: { message?: string } }) | null;
  if (!response.ok || !json) return { ok: false, error: json?.error?.message ?? `HTTP ${response.status}` };
  return { ok: true, data: json };
}

/** Emails a Firebase password reset link to `email`, in Arabic or English. Throws when Firebase refuses. */
export async function sendFirebaseResetLink(email: string, language: string) {
  const created = await identity('signUp', { email, password: randomBytes(24).toString('base64url'), returnSecureToken: false });
  if (!created.ok && created.error !== 'EMAIL_EXISTS') throw new Error(`Firebase sign-up failed: ${created.error}`);
  const sent = await identity('sendOobCode', { requestType: 'PASSWORD_RESET', email }, language === 'en' ? 'en' : 'ar');
  if (!sent.ok) throw new Error(`Firebase reset email failed: ${sent.error}`);
}

/** Uses up a reset link's code and returns the email it was sent to. Wrong, used or expired codes throw. */
export async function redeemFirebaseResetCode(oobCode: string) {
  if (!firebaseConfigured()) throw new AppError(400, 'This link is wrong, used or expired. Ask for a new one.', [], 'INVALID_RESET_LINK');
  const result = await identity<{ email?: string }>('resetPassword', { oobCode, newPassword: randomBytes(24).toString('base64url') });
  if (!result.ok || !result.data.email) {
    throw new AppError(400, 'This link is wrong, used or expired. Ask for a new one.', [], 'INVALID_RESET_LINK');
  }
  return result.data.email.toLowerCase();
}
