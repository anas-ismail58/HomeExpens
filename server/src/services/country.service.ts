import type { Country, Currency, Family, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { Decimal } from '../utils/money';
import { assertAdmin, type Actor } from './access.service';
import { convertAmount, getExchangeRates } from './rates.service';

/** Countries a family can add, each with its currency (EU = the euro area). */
export const COUNTRY_CURRENCY: Record<string, Currency> = { SA: 'SAR', EG: 'EGP', AE: 'AED', KW: 'KWD', QA: 'QAR', BH: 'BHD', US: 'USD', EU: 'EUR' };

export function countryForCurrency(currency: Currency) {
  return Object.keys(COUNTRY_CURRENCY).find((code) => COUNTRY_CURRENCY[code] === currency) ?? 'EU';
}

type Db = Prisma.TransactionClient | typeof prisma;

/** The family's default country, created on first use (families made before countries existed get one too). */
export async function defaultCountry(familyId: string, db: Db = prisma): Promise<Country> {
  const found = await db.country.findFirst({ where: { familyId, isDefault: true } });
  if (found) return found;
  const family = await db.family.findUniqueOrThrow({ where: { id: familyId }, select: { currency: true } });
  const code = countryForCurrency(family.currency);
  return db.country.upsert({
    where: { familyId_code: { familyId, code } },
    update: { isDefault: true, isActive: true },
    create: { familyId, code, currency: family.currency, isDefault: true },
  });
}

/**
 * The country the app has selected (the X-Country header): a country id, or null for "all countries".
 * A missing header (older app versions) also means all countries, so nothing disappears for them.
 */
export async function resolveSelectedCountry(familyId: string, header: string | undefined): Promise<string | null> {
  if (!header || header === 'all') return null;
  const country = await prisma.country.findFirst({ where: { id: header, familyId, isActive: true }, select: { id: true } });
  if (!country) throw new AppError(400, 'This country is no longer in the family. Choose another one.', [], 'UNKNOWN_COUNTRY');
  return country.id;
}

/** The country a new record goes to: the selected one, or the default when "all countries" is shown. */
export async function writeCountry(actor: Actor, db: Db = prisma): Promise<Country> {
  if (actor.countryId) {
    const country = await db.country.findFirst({ where: { id: actor.countryId, familyId: actor.familyId } });
    if (country) return country;
  }
  return defaultCountry(actor.familyId, db);
}

/**
 * How an amount entered in `currency` is stored in a country's ledger: `currency` (null = the family
 * currency, as before countries) and `familyAmount`, its value in the country's currency (null = the same
 * as `amount`). Totals of one country add `familyAmount ?? amount`.
 */
export async function ledgerPricing(family: Pick<Family, 'currency'>, country: Pick<Country, 'currency'>, amount: string | Prisma.Decimal, currency: Currency | null | undefined) {
  const entered = currency ?? family.currency;
  return {
    currency: entered === family.currency ? null : entered,
    familyAmount: entered === country.currency ? null : await convertAmount(new Decimal(amount), entered, country.currency),
  };
}

type Valued = { countryId: string | null; amount: Prisma.Decimal; familyAmount: Prisma.Decimal | null };

export interface Ledger {
  /** Currency totals are shown in: the selected country's, or the family's for all countries. */
  currency: Currency;
  /** The selected country (null = all). */
  countryId: string | null;
  /** A record's value in `currency`. */
  value: (item: Valued) => Prisma.Decimal;
}

/**
 * Totals for what the actor is looking at. One country: its records in its own currency. All countries:
 * each country's records converted to the family currency at today's rate.
 */
export async function ledger(actor: Actor): Promise<Ledger> {
  const [family, countries] = await Promise.all([
    prisma.family.findUniqueOrThrow({ where: { id: actor.familyId }, select: { currency: true } }),
    prisma.country.findMany({ where: { familyId: actor.familyId }, select: { id: true, currency: true } }),
  ]);
  const base = (item: Valued) => item.familyAmount ?? item.amount;
  if (actor.countryId) {
    const selected = countries.find((country) => country.id === actor.countryId);
    return { currency: selected?.currency ?? family.currency, countryId: actor.countryId, value: base };
  }
  const factors = new Map<string, Prisma.Decimal>();
  const foreign = countries.filter((country) => country.currency !== family.currency);
  if (foreign.length) {
    const rates = (await getExchangeRates()).rates;
    for (const country of foreign) {
      if (!rates[country.currency] || !rates[family.currency]) throw new AppError(503, `No exchange rate for ${country.currency}`, [], 'RATES_UNAVAILABLE');
      factors.set(country.id, new Decimal(rates[family.currency]).div(rates[country.currency]));
    }
  }
  return {
    currency: family.currency,
    countryId: null,
    value: (item) => {
      const factor = item.countryId ? factors.get(item.countryId) : undefined;
      return factor ? base(item).mul(factor).toDecimalPlaces(3) : base(item);
    },
  };
}

/** Currency totals are shown in for what the actor is looking at (selected country, or the family's). */
export async function viewCurrency(actor: Actor, familyCurrency: Currency) {
  if (!actor.countryId) return familyCurrency;
  const country = await prisma.country.findFirst({ where: { id: actor.countryId, familyId: actor.familyId }, select: { currency: true } });
  return country?.currency ?? familyCurrency;
}

function countryDto(country: Country) {
  return { id: country.id, code: country.code, currency: country.currency, isDefault: country.isDefault };
}

export async function listCountries(actor: Actor) {
  await defaultCountry(actor.familyId);
  const rows = await prisma.country.findMany({ where: { familyId: actor.familyId, isActive: true }, orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] });
  return rows.map(countryDto);
}

/** Adds a country (or brings back one removed earlier, with its records). Father only. */
export async function addCountry(actor: Actor, code: string) {
  assertAdmin(actor);
  const currency = COUNTRY_CURRENCY[code];
  if (!currency) throw AppError.badRequest('Unknown country');
  await defaultCountry(actor.familyId);
  const last = await prisma.country.aggregate({ where: { familyId: actor.familyId }, _max: { sortOrder: true } });
  const country = await prisma.country.upsert({
    where: { familyId_code: { familyId: actor.familyId, code } },
    update: { isActive: true },
    create: { familyId: actor.familyId, code, currency, sortOrder: (last._max.sortOrder ?? 0) + 1 },
  });
  return countryDto(country);
}

/** Makes a country the default (where records go when none is chosen). Father only. */
export async function setDefaultCountry(actor: Actor, id: string) {
  assertAdmin(actor);
  const country = await prisma.country.findFirst({ where: { id, familyId: actor.familyId, isActive: true } });
  if (!country) throw AppError.notFound('Country not found');
  await prisma.$transaction([
    prisma.country.updateMany({ where: { familyId: actor.familyId, isDefault: true }, data: { isDefault: false } }),
    prisma.country.update({ where: { id }, data: { isDefault: true } }),
  ]);
  return listCountries(actor);
}

/** Hides a country from the switcher; its records stay and still count in "all countries". Father only. */
export async function removeCountry(actor: Actor, id: string) {
  assertAdmin(actor);
  const country = await prisma.country.findFirst({ where: { id, familyId: actor.familyId, isActive: true } });
  if (!country) throw AppError.notFound('Country not found');
  if (country.isDefault) throw new AppError(409, 'Choose another default country before removing this one.', [], 'DEFAULT_COUNTRY');
  await prisma.country.update({ where: { id }, data: { isActive: false } });
}
