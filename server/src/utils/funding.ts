import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from './AppError';
import { Decimal } from './money';

/** Where the money for an expense or payment comes from. */
export const FUNDING_SOURCES = ['SALARY', 'PERSONAL', 'HOUSEHOLD', 'OTHER'] as const;
export type FundingSource = (typeof FUNDING_SOURCES)[number];
export type FundingPart = { source: FundingSource; amount: string };

/** One or more sources whose amounts add up to the record's amount. */
export const fundingSchema = z
  .array(
    z.object({
      source: z.enum(FUNDING_SOURCES),
      amount: z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero'),
    }),
  )
  .min(1)
  .max(FUNDING_SOURCES.length);

/** The funding to store for `amount`: parts merged by source and checked to add up exactly. */
export function checkedFunding(funding: FundingPart[] | undefined | null, amount: string | Prisma.Decimal): Prisma.InputJsonValue | undefined {
  if (!funding) return undefined;
  const merged = new Map<FundingSource, Prisma.Decimal>();
  for (const part of funding) merged.set(part.source, (merged.get(part.source) ?? new Decimal(0)).plus(part.amount));
  const total = [...merged.values()].reduce((sum, value) => sum.plus(value), new Decimal(0));
  if (!total.equals(new Decimal(amount))) {
    throw new AppError(422, 'The funding parts must add up to the amount', [{ field: 'funding', message: 'The funding parts must add up to the amount' }], 'FUNDING_MISMATCH');
  }
  return [...merged.entries()].map(([source, value]) => ({ source, amount: value.toString() }));
}

/** When the amount changes: a single-source funding follows it; a split must be given again. */
export function refundedFor(current: Prisma.JsonValue | null, amount: string | Prisma.Decimal): Prisma.InputJsonValue | undefined {
  const parts = parseFunding(current);
  if (!parts) return undefined;
  if (parts.length === 1) return [{ source: parts[0].source, amount: new Decimal(amount).toString() }];
  throw new AppError(422, 'Give the funding split again for the new amount', [{ field: 'funding', message: 'Give the funding split again for the new amount' }], 'FUNDING_MISMATCH');
}

export function parseFunding(value: Prisma.JsonValue | null | undefined): FundingPart[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((part): part is FundingPart => typeof part === 'object' && part !== null && 'source' in part && 'amount' in part);
}

/** Each source's share (0..1) of a record; no funding recorded = all from the salary. */
export function fundingShares(value: Prisma.JsonValue | null | undefined, amount: Prisma.Decimal): Map<FundingSource, number> {
  const parts = parseFunding(value);
  if (!parts || amount.isZero()) return new Map([['SALARY', 1]]);
  return new Map(parts.map((part) => [part.source, Number(new Decimal(part.amount).div(amount))]));
}
