import { Prisma } from '@prisma/client';

/**
 * Money helpers. All amounts are Prisma.Decimal on the server and are
 * serialized to strings in API responses — never JS floats.
 */
export const Decimal = Prisma.Decimal;
export type DecimalValue = Prisma.Decimal;

export const ZERO = new Prisma.Decimal(0);

export function toDecimal(value: Prisma.Decimal.Value | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined) return ZERO;
  return new Prisma.Decimal(value);
}

export function sum(values: Array<Prisma.Decimal.Value | null | undefined>): Prisma.Decimal {
  return values.reduce<Prisma.Decimal>((acc, v) => acc.plus(toDecimal(v)), ZERO);
}

/** Percentage (0–∞) rounded to 1 decimal. Returns 0 when total is 0. */
export function percentage(part: Prisma.Decimal.Value, total: Prisma.Decimal.Value): number {
  const t = toDecimal(total);
  if (t.isZero()) return 0;
  return toDecimal(part).div(t).times(100).toDecimalPlaces(1).toNumber();
}

/** Minor units per currency (KWD/BHD use 3 decimals). */
export const CURRENCY_DECIMALS: Record<string, number> = {
  SAR: 2, EGP: 2, USD: 2, EUR: 2, AED: 2, QAR: 2, KWD: 3, BHD: 3,
};

export function toMoneyString(value: Prisma.Decimal.Value, currency = 'SAR'): string {
  return toDecimal(value).toFixed(CURRENCY_DECIMALS[currency] ?? 2);
}
