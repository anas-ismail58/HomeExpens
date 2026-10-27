import { createHash, randomBytes } from 'node:crypto';
import type { Currency, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly, parseDateOnly } from '../utils/dates';
import { Decimal, toMoneyString } from '../utils/money';
import { localDate } from '../utils/time';
import type { Actor } from './access.service';
import { getExchangeRates } from './rates.service';

/**
 * The savings vault: money a member sets aside, separate from what the family spends. Each adult has their
 * own; nobody else (no role, no permission, not even the father) can read another member's vault. Reading
 * or changing it needs a short-lived unlock token, obtained with the account password or a trusted phone's
 * key (kept in the phone's secure storage behind Face ID / fingerprint).
 */
const VAULT_AUDIENCE = 'vault';
const UNLOCK_MINUTES = 10;
const MAX_DEVICES = 5;

const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

function assertAdult(actor: Actor) {
  if (actor.role === 'CHILD') throw AppError.forbidden('The savings vault is for adults');
}

function unlockToken(userId: string) {
  const expiresAt = new Date(Date.now() + UNLOCK_MINUTES * 60_000);
  return { token: jwt.sign({}, env.JWT_SECRET, { subject: userId, audience: VAULT_AUDIENCE, expiresIn: `${UNLOCK_MINUTES}m` }), expiresAt: expiresAt.toISOString() };
}

/** Opens the vault with the account password or a trusted device key. */
export async function unlockVault(actor: Actor, input: { password?: string; deviceKey?: string }) {
  assertAdult(actor);
  if (input.deviceKey) {
    const device = await prisma.vaultDevice.findUnique({ where: { keyHash: hashKey(input.deviceKey) } });
    if (!device || device.userId !== actor.userId) throw new AppError(401, 'This phone is no longer trusted for the vault. Use your password.', [], 'VAULT_DEVICE_UNKNOWN');
    await prisma.vaultDevice.update({ where: { id: device.id }, data: { lastUsedAt: new Date() } });
    return unlockToken(actor.userId);
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { passwordHash: true } });
  if (!input.password || !(await bcrypt.compare(input.password, user.passwordHash))) throw new AppError(401, 'The password is incorrect', [], 'VAULT_WRONG_PASSWORD');
  return unlockToken(actor.userId);
}

/** Checks the unlock token sent with a vault request belongs to this member and hasn't expired. */
export function assertUnlocked(actor: Actor, token: string | undefined) {
  assertAdult(actor);
  let payload: JwtPayload | null = null;
  try {
    payload = token ? (jwt.verify(token, env.JWT_SECRET, { audience: VAULT_AUDIENCE }) as JwtPayload) : null;
  } catch {
    payload = null;
  }
  if (!payload || payload.sub !== actor.userId) throw new AppError(401, 'Unlock the vault again.', [], 'VAULT_LOCKED');
}

/** Trusts this phone: returns a random key the phone keeps behind biometrics; only its hash is stored. */
export async function trustDevice(actor: Actor, label?: string) {
  const count = await prisma.vaultDevice.count({ where: { userId: actor.userId } });
  if (count >= MAX_DEVICES) throw new AppError(409, 'Remove a trusted phone first (at most 5).', [], 'VAULT_DEVICE_LIMIT');
  const deviceKey = randomBytes(32).toString('base64url');
  const device = await prisma.vaultDevice.create({ data: { userId: actor.userId, keyHash: hashKey(deviceKey), label: label?.slice(0, 60) ?? null } });
  return { id: device.id, deviceKey };
}

export async function forgetDevice(actor: Actor, id: string) {
  const { count } = await prisma.vaultDevice.deleteMany({ where: { id, userId: actor.userId } });
  if (!count) throw AppError.notFound('Device not found');
}

type Entry = { direction: 'DEPOSIT' | 'WITHDRAW'; amount: Prisma.Decimal; currency: Currency };
const signed = (entry: Entry) => (entry.direction === 'DEPOSIT' ? entry.amount : entry.amount.neg());

/** What is saved in each currency. */
function balances(entries: Entry[]) {
  const totals = new Map<Currency, Prisma.Decimal>();
  for (const entry of entries) totals.set(entry.currency, (totals.get(entry.currency) ?? new Decimal(0)).plus(signed(entry)));
  return totals;
}

async function toCurrency(totals: Map<Currency, Prisma.Decimal>, target: Currency) {
  const needsRates = [...totals.keys()].some((currency) => currency !== target);
  const rates = needsRates ? (await getExchangeRates().catch(() => null))?.rates ?? null : null;
  let total = new Decimal(0);
  for (const [currency, amount] of totals) {
    if (currency === target) total = total.plus(amount);
    else if (rates?.[currency] && rates[target]) total = total.plus(amount.div(rates[currency]).mul(rates[target]));
    else return null;
  }
  return total.toDecimalPlaces(3);
}

export async function getVault(actor: Actor) {
  const [entries, devices, family] = await Promise.all([
    prisma.vaultEntry.findMany({ where: { userId: actor.userId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    prisma.vaultDevice.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: 'asc' } }),
    prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } }),
  ]);
  const totals = balances(entries);
  const total = await toCurrency(totals, family.currency);
  return {
    currency: family.currency,
    /** Everything saved, in the family currency at today's rates (null when a rate is missing). */
    total: total ? toMoneyString(total, family.currency) : null,
    balances: [...totals.entries()].filter(([, amount]) => !amount.isZero()).map(([currency, amount]) => ({ currency, amount: toMoneyString(amount, currency) })),
    entries: entries.slice(0, 200).map((entry) => ({ id: entry.id, direction: entry.direction, amount: entry.amount.toString(), currency: entry.currency, source: entry.source, note: entry.note, date: formatDateOnly(entry.date) })),
    devices: devices.map((device) => ({ id: device.id, label: device.label, createdAt: device.createdAt.toISOString(), lastUsedAt: device.lastUsedAt?.toISOString() ?? null })),
  };
}

export type VaultSourceInput = 'SALARY' | 'PRIVATE' | 'OTHER';

/**
 * A deposit or withdrawal, with where the money comes from (or goes back to): this month's salary (it
 * comes off / goes back to the remaining salary), the father's private money (recorded there too), or
 * anything else (no other balance changes).
 */
export async function addVaultEntry(actor: Actor, input: { direction: 'DEPOSIT' | 'WITHDRAW'; amount: string; currency: Currency; source?: VaultSourceInput; note?: string; date?: string }) {
  const amount = new Decimal(input.amount);
  const source = input.source ?? 'OTHER';
  if (input.direction === 'WITHDRAW') {
    const entries = await prisma.vaultEntry.findMany({ where: { userId: actor.userId, currency: input.currency }, select: { direction: true, amount: true, currency: true } });
    const available = balances(entries).get(input.currency) ?? new Decimal(0);
    if (amount.greaterThan(available)) throw new AppError(422, 'You can only take out what is saved in this currency.', [], 'VAULT_INSUFFICIENT');
  }
  const date = parseDateOnly(input.date ?? localDate(new Date(), actor.timezone));

  // From / to private money: the same amount in the family currency (private money's currency).
  let privateAmount: Prisma.Decimal | null = null;
  if (source === 'PRIVATE') {
    if (actor.role !== 'FATHER') throw AppError.forbidden('Private money is only available to the father');
    const family = await prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } });
    privateAmount = (await toCurrency(new Map([[input.currency, amount]]), family.currency)) ?? null;
    if (!privateAmount) throw new AppError(503, 'Exchange rates are unavailable right now', [], 'RATES_UNAVAILABLE');
    if (input.direction === 'DEPOSIT') {
      const rows = await prisma.privateEntry.groupBy({ by: ['direction'], where: { userId: actor.userId }, _sum: { amount: true } });
      const sum = (direction: 'IN' | 'OUT') => rows.find((row) => row.direction === direction)?._sum.amount ?? new Decimal(0);
      if (privateAmount.greaterThan(sum('IN').minus(sum('OUT')))) throw new AppError(422, 'Your private money is less than this amount.', [], 'PRIVATE_INSUFFICIENT');
    }
  }

  await prisma.$transaction(async (tx) => {
    const privateEntry = privateAmount
      ? await tx.privateEntry.create({
          data: {
            userId: actor.userId,
            // Into the vault = out of private money; back from the vault = in.
            direction: input.direction === 'DEPOSIT' ? 'OUT' : 'IN',
            amount: privateAmount,
            note: input.note ? `خزنة المدخرات: ${input.note}` : 'خزنة المدخرات',
            date,
          },
          select: { id: true },
        })
      : null;
    await tx.vaultEntry.create({
      data: { userId: actor.userId, direction: input.direction, amount, currency: input.currency, source, privateEntryId: privateEntry?.id ?? null, note: input.note || null, date },
    });
  });
  return getVault(actor);
}

export async function deleteVaultEntry(actor: Actor, id: string) {
  const entry = await prisma.vaultEntry.findFirst({ where: { id, userId: actor.userId } });
  if (!entry) throw AppError.notFound('Entry not found');
  // Removing a deposit must not leave the vault below zero in that currency.
  if (entry.direction === 'DEPOSIT') {
    const entries = await prisma.vaultEntry.findMany({ where: { userId: actor.userId, currency: entry.currency, id: { not: id } }, select: { direction: true, amount: true, currency: true } });
    if ((balances(entries).get(entry.currency) ?? new Decimal(0)).isNegative()) throw new AppError(422, 'Remove the withdrawals that use this money first.', [], 'VAULT_INSUFFICIENT');
  }
  await prisma.$transaction(async (tx) => {
    await tx.vaultEntry.delete({ where: { id } });
    // Its private money entry goes too, so both stay in step.
    if (entry.privateEntryId) await tx.privateEntry.deleteMany({ where: { id: entry.privateEntryId, userId: actor.userId } });
  });
  return getVault(actor);
}

/**
 * What one member moved from this month's salary into their vault (deposits minus withdrawals marked
 * "salary"), in `currency`. Taken off the remaining salary they see; never shown to anyone else. Vault
 * money from private money or elsewhere doesn't touch the salary.
 */
export async function vaultSavedInMonth(userId: string, range: { start: Date; end: Date }, currency: Currency | string) {
  const entries = await prisma.vaultEntry.findMany({ where: { userId, source: 'SALARY', date: { gte: range.start, lt: range.end } }, select: { direction: true, amount: true, currency: true } });
  if (!entries.length) return new Decimal(0);
  return (await toCurrency(balances(entries), currency as Currency)) ?? new Decimal(0);
}
