import type { PaymentFrequency } from '@prisma/client';
import { formatDateOnly, parseDateOnly } from './dates';

/** Throws for an unknown IANA zone so bad input never reaches the database. */
export function assertTimeZone(timeZone: string) {
  new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  return timeZone;
}

export function isValidTimeZone(timeZone: string) {
  try {
    assertTimeZone(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetAt(instant: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Local wall-clock date ("YYYY-MM-DD") + time ("HH:MM") in `timeZone` -> UTC instant. DST-safe. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  const first = wall - offsetAt(wall, timeZone);
  const second = wall - offsetAt(first, timeZone);
  return new Date(second);
}

/** Calendar date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function localDate(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

export function addDays(date: string, days: number) {
  const value = parseDateOnly(date);
  value.setUTCDate(value.getUTCDate() + days);
  return formatDateOnly(value);
}

export function daysBetween(from: string, to: string) {
  return Math.round((parseDateOnly(to).getTime() - parseDateOnly(from).getTime()) / 86_400_000);
}

/** Adds whole months, keeping `anchorDay` (clamped to short months: 31 Jan -> 28/29 Feb -> 31 Mar). */
function addMonths(date: string, months: number, anchorDay: number) {
  const value = parseDateOnly(date);
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return formatDateOnly(new Date(Date.UTC(year, month, Math.min(anchorDay, lastDay))));
}

const MONTH_STEPS: Partial<Record<PaymentFrequency, number>> = { MONTHLY: 1, QUARTERLY: 3, SEMI_ANNUAL: 6, YEARLY: 12 };

/**
 * The due date after `dueDate` for a recurring payment, or null for one-time payments.
 * Month-based frequencies stay on the start date's day of month.
 */
export function nextDueDate(dueDate: string, frequency: PaymentFrequency, startDate: string, customIntervalDays?: number | null) {
  if (frequency === 'ONCE') return null;
  if (frequency === 'DAILY') return addDays(dueDate, 1);
  if (frequency === 'WEEKLY') return addDays(dueDate, 7);
  if (frequency === 'CUSTOM') return addDays(dueDate, Math.max(1, customIntervalDays ?? 30));
  return addMonths(dueDate, MONTH_STEPS[frequency] ?? 1, parseDateOnly(startDate).getUTCDate());
}

export type PaymentStatus = 'UPCOMING' | 'DUE_SOON' | 'DUE_TODAY' | 'OVERDUE' | 'PAID' | 'CANCELLED';

/** Days before the due date at which a payment counts as "due soon". */
export const DUE_SOON_DAYS = 3;

/**
 * Display status. A recurring payment whose last cycle was paid shows PAID until the next cycle
 * becomes due soon, so "mark as paid" is visible without hiding the next due date.
 */
export function paymentStatus(
  payment: { state: string; dueDate: Date; dueAt: Date; timezone: string; lastPaidAt: Date | null },
  now = new Date(),
): PaymentStatus {
  if (payment.state === 'CANCELLED') return 'CANCELLED';
  if (payment.state === 'PAID') return 'PAID';
  if (now >= payment.dueAt) return 'OVERDUE';
  const days = daysBetween(localDate(now, payment.timezone), formatDateOnly(payment.dueDate));
  if (days <= 0) return 'DUE_TODAY';
  if (days <= DUE_SOON_DAYS) return 'DUE_SOON';
  return payment.lastPaidAt ? 'PAID' : 'UPCOMING';
}
