import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDateOnly } from '../src/utils/dates';
import { localDate, nextDueDate, paymentStatus, zonedToUtc } from '../src/utils/time';

test('zonedToUtc converts Riyadh wall-clock time (UTC+3)', () => {
  assert.equal(zonedToUtc('2026-10-15', '20:00', 'Asia/Riyadh').toISOString(), '2026-10-15T17:00:00.000Z');
});

test('zonedToUtc is DST-aware', () => {
  assert.equal(zonedToUtc('2026-07-01', '09:00', 'America/New_York').toISOString(), '2026-07-01T13:00:00.000Z');
  assert.equal(zonedToUtc('2026-12-01', '09:00', 'America/New_York').toISOString(), '2026-12-01T14:00:00.000Z');
  assert.equal(zonedToUtc('2026-10-15', '20:00', 'Africa/Cairo').toISOString(), '2026-10-15T17:00:00.000Z');
});

test('localDate uses the zone, not UTC', () => {
  assert.equal(localDate(new Date('2026-10-14T22:30:00Z'), 'Asia/Riyadh'), '2026-10-15');
});

test('nextDueDate rolls forward per frequency', () => {
  assert.equal(nextDueDate('2026-10-15', 'MONTHLY', '2026-10-15'), '2026-11-15');
  assert.equal(nextDueDate('2026-10-15', 'QUARTERLY', '2026-10-15'), '2027-01-15');
  assert.equal(nextDueDate('2026-10-15', 'SEMI_ANNUAL', '2026-10-15'), '2027-04-15');
  assert.equal(nextDueDate('2026-10-15', 'YEARLY', '2026-10-15'), '2027-10-15');
  assert.equal(nextDueDate('2026-10-15', 'WEEKLY', '2026-10-15'), '2026-10-22');
  assert.equal(nextDueDate('2026-10-15', 'DAILY', '2026-10-15'), '2026-10-16');
  assert.equal(nextDueDate('2026-10-15', 'CUSTOM', '2026-10-15', 10), '2026-10-25');
  assert.equal(nextDueDate('2026-10-15', 'ONCE', '2026-10-15'), null);
});

test('monthly payments keep their day across short months', () => {
  assert.equal(nextDueDate('2027-01-31', 'MONTHLY', '2027-01-31'), '2027-02-28');
  assert.equal(nextDueDate('2027-02-28', 'MONTHLY', '2027-01-31'), '2027-03-31');
});

test('paymentStatus: upcoming → due soon → due today → overdue → paid', () => {
  const payment = (lastPaidAt: Date | null = null, state = 'ACTIVE') => ({
    state,
    dueDate: parseDateOnly('2026-10-15'),
    dueAt: zonedToUtc('2026-10-15', '20:00', 'Asia/Riyadh'),
    timezone: 'Asia/Riyadh',
    lastPaidAt,
  });
  assert.equal(paymentStatus(payment(), new Date('2026-10-01T09:00:00Z')), 'UPCOMING');
  assert.equal(paymentStatus(payment(), new Date('2026-10-13T09:00:00Z')), 'DUE_SOON');
  assert.equal(paymentStatus(payment(), new Date('2026-10-15T07:00:00Z')), 'DUE_TODAY'); // 10:00 Riyadh
  assert.equal(paymentStatus(payment(), new Date('2026-10-15T17:00:01Z')), 'OVERDUE'); // just after 20:00 Riyadh
  assert.equal(paymentStatus(payment(new Date()), new Date('2026-10-01T09:00:00Z')), 'PAID'); // last cycle paid
  assert.equal(paymentStatus(payment(null, 'PAID')), 'PAID');
  assert.equal(paymentStatus(payment(null, 'CANCELLED')), 'CANCELLED');
});
