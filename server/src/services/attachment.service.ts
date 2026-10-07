import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatDateOnly } from '../utils/dates';
import { can, expenseScope, paymentScope, type Actor } from './access.service';

/** Decoded size limit per image (the app compresses screenshots to ~150 KB before upload). */
export const MAX_ATTACHMENT_BYTES = 1_500_000;
const MAX_PER_ITEM = 20;
const MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
type Mime = (typeof MIME)[number];

export type AttachmentTarget = { expenseId?: string; paymentId?: string; paymentRecordId?: string };

/** The file must really be the image type it claims (checked by its magic bytes). */
function matchesMime(bytes: Buffer, mime: Mime) {
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

/**
 * Finds the item an attachment belongs to, if the actor can see it, and whether they may change its
 * attachments: expenses need EDIT_EXPENSE (or having added it), payments EDIT_PAYMENT (or being the assignee).
 */
async function resolveTarget(actor: Actor, target: AttachmentTarget) {
  if (target.expenseId) {
    const expense = await prisma.expense.findFirst({ where: { AND: [expenseScope(actor), { id: target.expenseId, deletedAt: null }] } });
    if (!expense) throw AppError.notFound('Expense not found');
    return { where: { expenseId: expense.id }, data: { expenseId: expense.id }, canEdit: can(actor, 'EDIT_EXPENSE') || expense.createdById === actor.userId };
  }
  let paymentId = target.paymentId;
  let paymentRecordId: string | null = null;
  if (target.paymentRecordId) {
    const record = await prisma.paymentRecord.findFirst({ where: { id: target.paymentRecordId, familyId: actor.familyId } });
    if (!record) throw AppError.notFound('Payment record not found');
    paymentId = record.paymentId;
    paymentRecordId = record.id;
  }
  if (!paymentId) throw AppError.badRequest('Choose what to attach the image to');
  const payment = await prisma.payment.findFirst({ where: { AND: [paymentScope(actor), { id: paymentId, deletedAt: null }] } });
  if (!payment) throw AppError.notFound('Payment not found');
  return { where: { paymentId: payment.id }, data: { paymentId: payment.id, paymentRecordId }, canEdit: can(actor, 'EDIT_PAYMENT') || payment.assigneeId === actor.userId };
}

export async function createAttachment(actor: Actor, input: AttachmentTarget & { mimeType: Mime; data: string; width?: number; height?: number }) {
  const target = await resolveTarget(actor, input);
  if (!target.canEdit) throw AppError.forbidden('You do not have permission to add attachments here');
  const bytes = Buffer.from(input.data.replace(/^data:[^,]+,/, ''), 'base64');
  if (!bytes.length) throw AppError.badRequest('Empty image');
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new AppError(413, 'Image is too large (max 1.5 MB)', [], 'TOO_LARGE');
  if (!matchesMime(bytes, input.mimeType)) throw AppError.badRequest('The file is not a valid image');
  const count = await prisma.attachment.count({ where: target.where });
  if (count >= MAX_PER_ITEM) throw AppError.conflict(`Up to ${MAX_PER_ITEM} images per item`);

  const row = await prisma.attachment.create({
    data: {
      familyId: actor.familyId,
      uploadedById: actor.userId,
      ...target.data,
      mimeType: input.mimeType,
      size: bytes.length,
      width: input.width ?? null,
      height: input.height ?? null,
      data: bytes,
    },
    select: { id: true },
  });
  return (await listAttachments(actor, input)).find((item) => item.id === row.id);
}

/** Metadata only; the image itself comes from getAttachment. */
export async function listAttachments(actor: Actor, target: AttachmentTarget) {
  const resolved = await resolveTarget(actor, target);
  const rows = await prisma.attachment.findMany({
    where: resolved.where,
    select: {
      id: true,
      mimeType: true,
      size: true,
      width: true,
      height: true,
      createdAt: true,
      uploadedBy: { select: { id: true, name: true } },
      paymentRecord: { select: { id: true, dueDate: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((row) => ({
    id: row.id,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt.toISOString(),
    uploadedBy: row.uploadedBy,
    cycleDueDate: row.paymentRecord ? formatDateOnly(row.paymentRecord.dueDate) : null,
    canDelete: resolved.canEdit || row.uploadedBy?.id === actor.userId,
  }));
}

async function visibleAttachment(actor: Actor, id: string) {
  const row = await prisma.attachment.findFirst({ where: { id, familyId: actor.familyId } });
  if (!row) throw AppError.notFound('Attachment not found');
  // Same visibility as the item it belongs to.
  const target = await resolveTarget(actor, row.expenseId ? { expenseId: row.expenseId } : { paymentId: row.paymentId ?? undefined });
  return { row, target };
}

export async function getAttachment(actor: Actor, id: string) {
  const { row } = await visibleAttachment(actor, id);
  return { id: row.id, mimeType: row.mimeType, width: row.width, height: row.height, data: Buffer.from(row.data).toString('base64') };
}

export async function deleteAttachment(actor: Actor, id: string) {
  const { row, target } = await visibleAttachment(actor, id);
  if (!target.canEdit && row.uploadedById !== actor.userId) throw AppError.forbidden('You do not have permission to delete this image');
  await prisma.attachment.delete({ where: { id } });
}
