import Anthropic from '@anthropic-ai/sdk';
import type { Prisma, ReceiptCheck } from '@prisma/client';
import { z } from 'zod';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
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
}

export type ReceiptReader = (image: { mimeType: ImageInput['mimeType']; data: string }) => Promise<ReceiptReading | null>;

const READING_SCHEMA = {
  type: 'object',
  properties: {
    is_payment_proof: { type: 'boolean', description: 'true if the image is a payment confirmation, transfer receipt, wallet/bank screenshot, or paper receipt' },
    amount: { type: ['number', 'null'], description: 'the amount paid or transferred, without fees; null if not visible' },
    total_with_fees: { type: ['number', 'null'], description: 'the total including fees, only if shown separately; otherwise null' },
    currency: { type: ['string', 'null'], description: 'ISO 4217 code such as EGP, SAR, USD; null if not shown' },
    succeeded: { type: ['boolean', 'null'], description: 'false if the transfer is shown as failed, pending, or cancelled; null if not shown' },
  },
  required: ['is_payment_proof', 'amount', 'total_with_fees', 'currency', 'succeeded'],
  additionalProperties: false,
} as const;

const readingSchema = z.object({
  is_payment_proof: z.boolean(),
  amount: z.number().nonnegative().nullable(),
  total_with_fees: z.number().nonnegative().nullable(),
  currency: z.string().nullable(),
  succeeded: z.boolean().nullable(),
});

const SYSTEM = `You read payment screenshots and receipts for a family finance app in Egypt and the Gulf: bank transfers, InstaPay, mobile wallets (Vodafone Cash, etc.), card payments and paper receipts, in Arabic or English.
Report only what the image shows. Read Arabic-Indic digits (٠١٢٣٤٥٦٧٨٩) as numbers, and treat thousands separators (, ٬) and decimal marks (. ٫) correctly.
"ج.م" or "جنيه" is EGP, "ر.س" or "ريال" is SAR, "د.إ" is AED.
If the image is not a payment confirmation or receipt, set is_payment_proof to false and the other fields to null.`;

let client: Anthropic | null = null;

/** Claude reads the screenshot. Null when there's no API key or the call fails, so the payment is marked "not checked". */
const claudeReader: ReceiptReader = async (image) => {
  if (!env.ANTHROPIC_API_KEY) return null;
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 1 });
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
            { type: 'text', text: 'Read this payment screenshot.' },
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
    return { isPaymentProof: r.is_payment_proof, amount: r.amount, totalWithFees: r.total_with_fees, currency: r.currency?.toUpperCase() ?? null, succeeded: r.succeeded };
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

export interface ReceiptCheckResult {
  status: ReceiptCheck;
  reason: string | null;
  /** What was read from the screenshot. */
  amount: string | null;
  currency: string | null;
  /** What the payment expects. */
  expectedAmount: string;
  expectedCurrency: string;
  /** Payment confirmation is blocked unless the father overrides it. */
  blocked: boolean;
  /** For DUPLICATE: the payment the screenshot was already used for. */
  usedFor: { name: string; paidAt: string } | null;
  sha256: string;
}

const BLOCKING: ReceiptCheck[] = ['MISMATCH', 'UNREADABLE', 'DUPLICATE'];

/** Within 1% or one currency unit, whichever is larger (rounding, small fees shown in the amount). */
function close(read: Prisma.Decimal, expected: Prisma.Decimal) {
  const tolerance = Decimal.max(expected.times(0.01), new Decimal(1));
  return read.minus(expected).abs().lessThanOrEqualTo(tolerance);
}

async function compare(reading: ReceiptReading | null, payment: { amount: Prisma.Decimal; currency: string }): Promise<{ status: ReceiptCheck; reason: string | null }> {
  if (!reading) return { status: 'UNAVAILABLE', reason: 'SCAN_FAILED' };
  if (!reading.isPaymentProof) return { status: 'UNREADABLE', reason: 'NOT_A_RECEIPT' };
  if (reading.succeeded === false) return { status: 'MISMATCH', reason: 'TRANSFER_FAILED' };
  const candidates = [reading.amount, reading.totalWithFees].filter((v): v is number => v !== null && v > 0);
  if (!candidates.length) return { status: 'UNREADABLE', reason: 'AMOUNT_NOT_FOUND' };
  for (const value of candidates) {
    let read = new Decimal(value);
    if (reading.currency && reading.currency !== payment.currency) {
      try {
        read = await convertAmount(read, reading.currency, payment.currency);
      } catch {
        continue; // Unknown currency: compare the other candidates as they are.
      }
    }
    if (close(read, payment.amount)) return { status: 'MATCH', reason: null };
  }
  return { status: 'MISMATCH', reason: 'AMOUNT_DIFFERS' };
}

/**
 * Checks a payment screenshot before the payment is confirmed: same image used before, then the
 * amount on it vs the payment. Each image is scanned once per payment; later checks reuse the result.
 */
export async function checkReceipt(payment: { id: string; familyId: string; amount: Prisma.Decimal; currency: string }, receipt: ImageInput): Promise<ReceiptCheckResult> {
  const bytes = decodeImage(receipt);
  const sha256 = imageHash(bytes);
  const base = { expectedAmount: payment.amount.toString(), expectedCurrency: payment.currency, sha256 };

  const reused = await prisma.attachment.findFirst({
    where: { familyId: payment.familyId, sha256, paymentRecordId: { not: null } },
    select: { paymentRecord: { select: { paidAt: true, payment: { select: { name: true } } } } },
  });
  if (reused?.paymentRecord) {
    return { ...base, status: 'DUPLICATE', reason: 'DUPLICATE', amount: null, currency: null, blocked: true, usedFor: { name: reused.paymentRecord.payment.name, paidAt: reused.paymentRecord.paidAt.toISOString() } };
  }

  const cached = await prisma.receiptScan.findUnique({ where: { paymentId_sha256: { paymentId: payment.id, sha256 } } });
  if (cached && cached.status !== 'UNAVAILABLE') {
    return { ...base, status: cached.status, reason: cached.reason, amount: cached.amount?.toString() ?? null, currency: cached.currency, blocked: BLOCKING.includes(cached.status), usedFor: null };
  }

  const reading = await reader({ mimeType: receipt.mimeType, data: bytes.toString('base64') });
  const { status, reason } = await compare(reading, payment);
  const amount = reading?.amount ?? reading?.totalWithFees ?? null;
  const row = { status, reason, amount: amount === null ? null : new Decimal(amount), currency: reading?.currency ?? null };
  // An unavailable scan isn't kept, so the next attempt tries again.
  if (status !== 'UNAVAILABLE') {
    await prisma.receiptScan.upsert({ where: { paymentId_sha256: { paymentId: payment.id, sha256 } }, create: { familyId: payment.familyId, paymentId: payment.id, sha256, ...row }, update: row });
  }
  return { ...base, status, reason, amount: row.amount?.toString() ?? null, currency: row.currency, blocked: BLOCKING.includes(status), usedFor: null };
}
