import nodemailer from 'nodemailer';
import { env } from '../config/env';

const smtpConfigured = () => Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);

/** True when the server can send email (SMTP, e.g. Gmail with an App Password, or a Resend API key). */
export const canSendMail = () => smtpConfigured() || Boolean(env.RESEND_API_KEY);

/** Sends one email over SMTP when configured, otherwise through Resend's HTTP API. Throws when neither works. */
export async function sendMail(to: string, subject: string, text: string, html: string) {
  if (smtpConfigured()) {
    const port = env.SMTP_PORT ?? 587;
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      connectionTimeout: 8000,
      socketTimeout: 8000,
    });
    await transport.sendMail({ from: env.MAIL_FROM ?? `Family Expenses <${env.SMTP_USER}>`, to, subject, text, html });
    return;
  }
  if (!env.RESEND_API_KEY) throw new Error('Email is not configured (SMTP_* or RESEND_API_KEY)');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM ?? 'Family Expenses <onboarding@resend.dev>', to: [to], subject, text, html }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Email failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
}
