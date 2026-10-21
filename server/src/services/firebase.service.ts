import { randomBytes } from 'node:crypto';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

/**
 * Firebase Authentication emails the password reset link (from its own address, no mail account of ours).
 * Firebase only mails people it knows, so each account is mirrored there by email with a random password
 * nobody knows. Two ways the new password reaches us:
 * - the link opens our /reset-password page (when the console's action URL points there), which sets it here;
 * - the link opens Firebase's own page, which sets it in Firebase, and the next sign-in with that password is
 *   checked with Firebase and adopted (see adoptFirebasePassword).
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

/** True when Firebase accepts this email and password (the password set on Firebase's reset page). */
export async function firebasePasswordMatches(email: string, password: string) {
  if (!firebaseConfigured()) return false;
  const result = await identity('signInWithPassword', { email, password, returnSecureToken: false });
  return result.ok;
}
