import { prisma } from '../config/prisma';
import { env } from '../config/env';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export function isExpoPushToken(token: string) {
  return EXPO_TOKEN.test(token);
}

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

type Ticket = { status: 'ok' | 'error'; message?: string; details?: { error?: string } };

/**
 * Sends one message to every registered device of the given users through Expo's push service.
 * Returns how many devices accepted it. Tokens Expo reports as unregistered are deleted.
 */
export async function sendPush(userIds: string[], message: PushMessage): Promise<{ delivered: number; devices: number; error?: string }> {
  if (!userIds.length) return { delivered: 0, devices: 0 };
  const tokens = await prisma.pushToken.findMany({ where: { userId: { in: userIds } }, select: { token: true } });
  if (!tokens.length) return { delivered: 0, devices: 0 };

  const payload = tokens.map(({ token }) => ({
    to: token,
    title: message.title,
    body: message.body,
    data: message.data ?? {},
    sound: 'default',
    priority: 'high',
    channelId: 'payments',
  }));

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const json = (await response.json().catch(() => null)) as { data?: Ticket[]; errors?: { message: string }[] } | null;
    if (!response.ok || !json?.data) {
      return { delivered: 0, devices: tokens.length, error: json?.errors?.[0]?.message ?? `Expo push HTTP ${response.status}` };
    }
    const stale = json.data
      .map((ticket, index) => (ticket.details?.error === 'DeviceNotRegistered' ? tokens[index].token : null))
      .filter((token): token is string => Boolean(token));
    if (stale.length) await prisma.pushToken.deleteMany({ where: { token: { in: stale } } });
    const delivered = json.data.filter((ticket) => ticket.status === 'ok').length;
    const firstError = json.data.find((ticket) => ticket.status === 'error')?.message;
    return { delivered, devices: tokens.length, ...(firstError && !delivered ? { error: firstError } : {}) };
  } catch (error) {
    return { delivered: 0, devices: tokens.length, error: error instanceof Error ? error.message : 'Push failed' };
  }
}
