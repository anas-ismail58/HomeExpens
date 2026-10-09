import type { NotificationType } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import type { Actor } from './access.service';
import { isExpoPushToken, sendPush } from './push.service';

export interface NotificationInput {
  familyId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedEntityId?: string | null;
}

/**
 * Stores a notification-center entry for each user and pushes it to their devices.
 * Only the listed users are notified — never the whole family implicitly.
 */
export async function notifyUsers(userIds: string[], input: NotificationInput) {
  const recipients = [...new Set(userIds)];
  if (!recipients.length) return { delivered: 0, devices: 0 };
  await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      familyId: input.familyId,
      type: input.type,
      title: input.title,
      message: input.message,
      relatedEntityId: input.relatedEntityId ?? null,
    })),
  });
  return sendPush(recipients, {
    title: input.title,
    body: input.message,
    data: { type: input.type, relatedEntityId: input.relatedEntityId ?? null, url: notificationUrl(input.type, input.relatedEntityId) },
  });
}

function notificationUrl(type: NotificationType, relatedEntityId?: string | null) {
  if ((type === 'PAYMENT_REMINDER' || type === 'PAYMENT_OVERDUE') && relatedEntityId) return `/payment/${relatedEntityId}`;
  if (type === 'PASSWORD_RESET_REQUEST') return '/family';
  return '/notifications';
}

function dto(row: { id: string; title: string; message: string; type: NotificationType; relatedEntityId: string | null; isRead: boolean; createdAt: Date }) {
  return {
    id: row.id,
    title: row.title,
    message: row.message,
    type: row.type,
    relatedEntityId: row.relatedEntityId,
    url: notificationUrl(row.type, row.relatedEntityId),
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Always scoped to the caller: a user only ever reads their own notifications. */
export async function listNotifications(actor: Actor, limit = 50) {
  const where = { userId: actor.userId, familyId: actor.familyId };
  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit }),
    prisma.notification.count({ where: { ...where, isRead: false } }),
  ]);
  return { items: rows.map(dto), unreadCount };
}

export async function markRead(actor: Actor, id: string) {
  const { count } = await prisma.notification.updateMany({ where: { id, userId: actor.userId }, data: { isRead: true, readAt: new Date() } });
  if (!count) throw AppError.notFound('Notification not found');
}

export async function markAllRead(actor: Actor) {
  const { count } = await prisma.notification.updateMany({
    where: { userId: actor.userId, familyId: actor.familyId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return { updated: count };
}

export async function deleteNotification(actor: Actor, id: string) {
  const { count } = await prisma.notification.deleteMany({ where: { id, userId: actor.userId } });
  if (!count) throw AppError.notFound('Notification not found');
}

/** Registers (or moves) a device token to the signed-in user. A device belongs to one user at a time. */
export async function registerPushToken(actor: Actor, token: string, platform: string) {
  if (!isExpoPushToken(token)) throw AppError.badRequest('Not an Expo push token');
  await prisma.pushToken.upsert({
    where: { token },
    create: { token, platform, userId: actor.userId },
    update: { userId: actor.userId, platform, lastSeenAt: new Date() },
  });
}

export async function unregisterPushToken(actor: Actor, token: string) {
  await prisma.pushToken.deleteMany({ where: { token, userId: actor.userId } });
}
