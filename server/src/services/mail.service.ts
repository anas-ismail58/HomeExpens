import { env } from '../config/env';

/** True when the server can send email (a Resend API key is configured). */
export const canSendMail = () => Boolean(env.RESEND_API_KEY);

/** Sends one email through Resend's HTTP API. Throws when it isn't configured or Resend refuses it. */
export async function sendMail(to: string, subject: string, text: string, html: string) {
  if (!env.RESEND_API_KEY) throw new Error('Email is not configured (RESEND_API_KEY)');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM ?? 'Family Expenses <onboarding@resend.dev>', to: [to], subject, text, html }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Email failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
}
