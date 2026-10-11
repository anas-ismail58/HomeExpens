import Anthropic from '@anthropic-ai/sdk';
import type { Prisma, ReceiptCheck } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { formatDateOnly } from '../utils/dates';
import { Decimal } from '../utils/money';
import { decodeImage, imageHash, type ImageInput } from './attachment.service';
import { convertAmount } from './rates.service';

/** What the scanner reads from a payment screenshot. */
export interface ReceiptReading {
  isPaymentProof: boolean;
  /** The amount sent / paid, without fees. */
  amount: number | null;
  /** Amount including fees, when the screenshot shows one. */
  totalWithFees: number | null;
  /** ISO 4217 code, when the screenshot shows the currency. */
  currency: string | null;
  /** false when the screenshot shows a failed / pending / cancelled transfer. */
  succeeded: boolean | null;
  /** "YYYY-MM-DD" of the transfer, when shown. */
  transferDate?: string | null;
  /** The receiver's phone / wallet number as shown; hidden digits kept as "*". */
  recipientNumber?: string | null;
  /** The receiver's name as shown. */
  recipientName?: string | null;
  /** Whether the receiver's first name is the teacher's first name (any script); null when not comparable. */
  firstNameMatches?: boolean | null;
}

export type ReceiptReader = (image: { mimeType: ImageInput['mimeType']; data: string }, context: { teacherName: string | null }) => Promise<ReceiptReading | null>;

const READING_SCHEMA = {
  type: 'object',
  properties: {
    is_payment_proof: { type: 'boolean', description: 'true if the image is a payment confirmation, transfer receipt, wallet/bank screenshot, or paper receipt' },
    amount: { type: ['number', 'null'], description: 'the amount paid or transferred, without fees; null if not visible' },
    total_with_fees: { type: ['number', 'null'], description: 'the total including fees, only if shown separately; otherwise null' },
    currency: { type: ['string', 'null'], description: 'ISO 4217 code such as EGP, SAR, USD; null if not shown' },
    succeeded: { type: ['boolean', 'null'], description: 'false if the transfer is shown as failed, pending, or cancelled; null if not shown' },
    transfer_date: { type: ['string', 'null'], description: 'date of the transfer as YYYY-MM-DD (Gregorian); null if not shown' },
    recipient_number: { type: ['string', 'null'], description: 'the receiver phone, wallet or account number exactly as shown, digits only, with * for each hidden digit; null if not shown' },
    recipient_name: { type: ['string', 'null'], description: 'the receiver name as shown; null if not shown' },
    first_name_matches: { type: ['boolean', 'null'], description: "true if the receiver's first name is the same name as the expected first name, allowing Arabic/English spelling (Eyad = إياد = Iyad); false if a different name; null if no receiver name is shown or no expected name was given" },
  },
  required: ['is_payment_proof', 'amount', 'total_with_fees', 'currency', 'succeeded', 'transfer_date', 'recipient_number', 'recipient_name', 'first_name_matches'],
  additionalProperties: false,
} as const;

const readingSchema = z.object({
  is_payment_proof: z.boolean(),
  amount: z.number().nonnegative().nullable(),
  total_with_fees: z.number().nonnegative().nullable(),
  currency: z.string().nullable(),
  succeeded: z.boolean().nullable(),
  transfer_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  recipient_number: z.string().max(40).nullable(),
  recipient_name: z.string().max(120).nullable(),
  first_name_matches: z.boolean().nullable(),
});

const SYSTEM = `You read payment screenshots and receipts for a family finance app in Egypt and the Gulf: bank transfers, InstaPay, mobile wallets (Vodafone Cash, etc.), card payments and paper receipts, in Arabic or English.
Report only what the image shows. Read Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) as numbers, and treat thousands separators (, ٬) and decimal marks (. ٫) correctly.
"ج.م" or "جنيه" is EGP, "ر.س" or "ريال" is SAR, "د.إ" is AED. Convert Hijri or written-out dates to Gregorian YYYY-MM-DD.
The receiver is who the money went to ("إلى", "المستلم", "To", "Recipient", "Beneficiary"), never the sender.
If the image is not a payment confirmation or receipt, set is_payment_proof to false and the other fields to null.`;

let client: Anthropic | null = null;

/** Claude reads the screenshot. Null when there's no API key or the call fails, so the payment is marked "not checked". */
const claudeReader: ReceiptReader = async (image, { teacherName }) => {
  if (!env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 1 });
  const firstName = teacherName?.trim().split(/\s+/)[0] ?? null;
  try {
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: READING_SCHEMA } },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.data } },
            { type: 'text', text: firstName ? `Read this payment screenshot. Expected receiver first name: ${JSON.stringify(firstName)}.` : 'Read this payment screenshot. No expected receiver name.' },
          ],
        },
      ],
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') return null;
    const parsed = readingSchema.safeParse(JSON.parse(text.text));
    if (!parsed.success) return null;
    const r = parsed.data;
    return {
      isPaymentProof: r.is_payment_proof,
      amount: r.amount,
      totalWithFees: r.total_with_fees,
      currency: r.currency?.toUpperCase() ?? null,
      succeeded: r.succeeded,
      transferDate: r.transfer_date,
      recipientNumber: r.recipient_number,
      recipientName: r.recipient_name,
      firstNameMatches: firstName ? r.first_name_matches : null,
    };
  } catch (error) {
    console.error('Receipt scan failed:', error instanceof Error ? error.message : error);
    return null;
  }
};

let reader: ReceiptReader = claudeReader;

/** Tests swap in a fake reader so they don't call the API. */
export function setReceiptReader(next: ReceiptReader | null) {
  reader = next ?? claudeReader;
}

export type CheckResult = 'ok' | 'bad' | 'unknown' | 'skipped';
export interface ReceiptChecks {
  amount: CheckResult;
  date: CheckResult;
  recipient: CheckResult;
}

export interface ReceiptCheckResult {
  status: ReceiptCheck;
  /** The first problem found (for the message): NOT_A_RECEIPT, TRANSFER_FAILED, AMOUNT_NOT_FOUND, AMOUNT_DIFFERS, DATE_OUT_OF_RANGE, WRONG_RECIPIENT, DUPLICATE, SCAN_FAILED. */
  reason: string | null;
  checks: ReceiptChecks;
  /** What was read from the screenshot. */
  amount: string | null;
  currency: string | null;
  transferDate: string | null;
  recipientNumber: string | null;
  recipientName: string | null;
  /** What the payment expects. */
  expectedAmount: string;
  expectedCurrency: string;
  /** "YYYY-MM": the transfer must be in the due date's month. */
  expectedMonth: string;
  teacher: { name: string; phone: string | null } | null;
  /** Payment confirmation is blocked unless the father overrides it. */
  blocked: boolean;
  /** For DUPLICATE: the payment the screenshot was already used for. */
  usedFor: { name: string; paidAt: string } | null;
  sha256: string;
}

type PaymentForCheck = {
  id: string;
  familyId: string;
  amount: Prisma.Decimal;
  currency: string;
  dueDate: Date;
  teacher: { name: string; phone: string | null } | null;
};

/** Within 1% or one currency unit, whichever is larger (rounding, small fees shown in the amount). */
function close(read: Prisma.Decimal, expected: Prisma.Decimal) {
  const tolerance = Decimal.max(expected.times(0.01), new Decimal(1));
  return read.minus(expected).abs().lessThanOrEqualTo(tolerance);
}

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Digits only (Arabic/Persian digits converted), with hidden digits as "*", in local form (+20 10… → 010…). */
export function normalizeNumber(raw: string) {
  let value = '';
  for (const ch of raw) {
    const ar = ARABIC_DIGITS.indexOf(ch);
    const fa = PERSIAN_DIGITS.indexOf(ch);
    if (ar >= 0) value += String(ar);
    else if (fa >= 0) value += String(fa);
    else if (/[0-9]/.test(ch)) value += ch;
    else if (/[*xX•●·]/.test(ch)) value += '*';
  }
  value = value.replace(/^00/, '');
  // Country codes: Egypt 20 (10/11/12/15…), Saudi 966, UAE 971, Kuwait 965, Qatar 974, Bahrain 973.
  for (const code of ['966', '971', '965', '974', '973', '20']) {
    if (value.startsWith(code) && value.length - code.length >= 8) return `0${value.slice(code.length)}`;
  }
  return value;
}

/**
 * Whether a number from the screenshot (possibly masked, e.g. 010****5678) is the teacher's number.
 * Compared from the right; every visible digit must agree, and at least 4 must be visible.
 */
export function numbersMatch(shown: string, saved: string) {
  const a = normalizeNumber(shown);
  const b = normalizeNumber(saved).replace(/\*/g, '');
  if (!a || !b) return null;
  let visible = 0;
  for (let i = 1; i <= Math.min(a.length, b.length); i++) {
    const x = a[a.length - i];
    if (x === '*') continue;
    if (x !== b[b.length - i]) return false;
    visible++;
  }
  return visible >= 4 ? true : null;
}

async function compare(reading: ReceiptReading | null, payment: PaymentForCheck): Promise<{ status: ReceiptCheck; reason: string | null; checks: ReceiptChecks }> {
  const none: ReceiptChecks = { amount: 'unknown', date: 'unknown', recipient: payment.teacher ? 'unknown' : 'skipped' };
  if (!reading) return { status: 'UNAVAILABLE', reason: 'SCAN_FAILED', checks: none };
  if (!reading.isPaymentProof) return { status: 'UNREADABLE', reason: 'NOT_A_RECEIPT', checks: { ...none, amount: 'bad' } };

  // Amount: the amount or the total with fees, in the payment currency.
  let amount: CheckResult = 'bad';
  const candidates = [reading.amount, reading.totalWithFees].filter((v): v is number => v !== null && v > 0);
  if (!candidates.length) amount = 'unknown';
  for (const value of candidates) {
    let read = new Decimal(value);
    if (reading.currency && reading.currency !== payment.currency) {
      try {
        read = await convertAmount(read, reading.currency, payment.currency);
      } catch {
        continue; // Unknown currency: compare the other candidates as they are.
      }
    }
    if (close(read, payment.amount)) {
      amount = 'ok';
      break;
    }
  }

  // Date: in the same calendar month as the due date. Not shown → can't tell (allowed).
  const dueMonth = formatDateOnly(payment.dueDate).slice(0, 7);
  const date: CheckResult = !reading.transferDate ? 'unknown' : reading.transferDate.slice(0, 7) === dueMonth ? 'ok' : 'bad';

  // Receiver: the teacher's number; without a number, the teacher's first name.
  let recipient: CheckResult = 'skipped';
  if (payment.teacher) {
    const byNumber = reading.recipientNumber && payment.teacher.phone ? numbersMatch(reading.recipientNumber, payment.teacher.phone) : null;
    if (byNumber !== null) recipient = byNumber ? 'ok' : 'bad';
    else if (reading.firstNameMatches !== null && reading.firstNameMatches !== undefined) recipient = reading.firstNameMatches ? 'ok' : 'bad';
    else recipient = 'unknown';
  }

  const checks = { amount, date, recipient };
  if (reading.succeeded === false) return { status: 'MISMATCH', reason: 'TRANSFER_FAILED', checks };
  if (amount === 'unknown') return { status: 'UNREADABLE', reason: 'AMOUNT_NOT_FOUND', checks };
  if (amount === 'bad') return { status: 'MISMATCH', reason: 'AMOUNT_DIFFERS', checks };
  if (date === 'bad') return { status: 'MISMATCH', reason: 'DATE_OUT_OF_RANGE', checks };
  if (recipient === 'bad') return { status: 'MISMATCH', reason: 'WRONG_RECIPIENT', checks };
  return { status: 'MATCH', reason: null, checks };
}

const BLOCKING: ReceiptCheck[] = ['MISMATCH', 'UNREADABLE', 'DUPLICATE'];

function toReading(json: Prisma.JsonValue | null): ReceiptReading | null {
  return json && typeof json === 'object' && !Array.isArray(json) ? (json as unknown as ReceiptReading) : null;
}

/**
 * Checks a payment screenshot before the payment is confirmed: same image used before, then the
 * amount, transfer date and receiver against the payment. Each image is read once per payment; the
 * reading is kept and compared again each time, so editing the payment or its teacher is respected.
 */
export async function checkReceipt(payment: PaymentForCheck, receipt: ImageInput): Promise<ReceiptCheckResult> {
  const bytes = decodeImage(receipt);
  const sha256 = imageHash(bytes);
  const teacher = payment.teacher ? { name: payment.teacher.name, phone: payment.teacher.phone } : null;
  const base = { expectedAmount: payment.amount.toString(), expectedCurrency: payment.currency, expectedMonth: formatDateOnly(payment.dueDate).slice(0, 7), teacher, sha256 };
  const empty = { amount: null, currency: null, transferDate: null, recipientNumber: null, recipientName: null };

  const reused = await prisma.attachment.findFirst({
    where: { familyId: payment.familyId, sha256, paymentRecordId: { not: null } },
    select: { paymentRecord: { select: { paidAt: true, payment: { select: { name: true } } } } },
  });
  if (reused?.paymentRecord) {
    return {
      ...base,
      ...empty,
      status: 'DUPLICATE',
      reason: 'DUPLICATE',
      checks: { amount: 'unknown', date: 'unknown', recipient: teacher ? 'unknown' : 'skipped' },
      blocked: true,
      usedFor: { name: reused.paymentRecord.payment.name, paidAt: reused.paymentRecord.paidAt.toISOString() },
    };
  }

  // Reuse an earlier reading of this image unless the teacher it was compared with changed.
  const cached = await prisma.receiptScan.findUnique({ where: { paymentId_sha256: { paymentId: payment.id, sha256 } } });
  let reading = cached && cached.status !== 'UNAVAILABLE' && (cached.teacherName ?? null) === (teacher?.name ?? null) ? toReading(cached.reading) : null;
  if (!reading) reading = await reader({ mimeType: receipt.mimeType, data: bytes.toString('base64') }, { teacherName: teacher?.name ?? null });

  const { status, reason, checks } = await compare(reading, payment);
  const amount = reading?.amount ?? reading?.totalWithFees ?? null;
  const row = {
    status,
    reason,
    amount: amount === null ? null : new Decimal(amount),
    currency: reading?.currency ?? null,
    reading: reading ? (JSON.parse(JSON.stringify(reading)) as Prisma.InputJsonValue) : undefined,
    teacherName: teacher?.name ?? null,
  };
  // An unavailable scan isn't kept, so the next attempt tries again.
  if (status !== 'UNAVAILABLE') {
    await prisma.receiptScan.upsert({ where: { paymentId_sha256: { paymentId: payment.id, sha256 } }, create: { familyId: payment.familyId, paymentId: payment.id, sha256, ...row }, update: row });
  }
  return {
    ...base,
    status,
    reason,
    checks,
    amount: row.amount?.toString() ?? null,
    currency: row.currency,
    transferDate: reading?.transferDate ?? null,
    recipientNumber: reading?.recipientNumber ?? null,
    recipientName: reading?.recipientName ?? null,
    blocked: BLOCKING.includes(status),
    usedFor: null,
  };
}
