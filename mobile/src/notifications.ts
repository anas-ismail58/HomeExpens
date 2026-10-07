import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerPushToken, unregisterPushToken, type Payment, type Session } from './api';
import type { StringKey } from './i18n';

type Translate = (key: StringKey, params?: Record<string, string | number>) => string;
type OnRefresh = (session: Session) => void;

/** Notifications are native-only; the web app shows the in-app notification center. */
export const notificationsSupported = Platform.OS !== 'web';

const CHANNEL_ID = 'payments';
let pushToken: string | null = null;

if (notificationsSupported) {
  // Show reminders as banners even when the app is open.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    void Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Payments',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    }).catch(() => undefined);
  }
}

export async function ensureNotificationPermission() {
  if (!notificationsSupported) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/**
 * Registers this device for server push (Expo push service). Returns false when push isn't
 * available — e.g. an iOS build signed without the push entitlement, or Android without FCM —
 * in which case the app falls back to on-device scheduled notifications.
 */
export async function registerDeviceForPush(session: Session, onRefresh: OnRefresh) {
  if (!notificationsSupported) return false;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return false;
  const projectId = (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ?? Constants.easConfig?.projectId;
  try {
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await registerPushToken(session, data, Platform.OS, onRefresh);
    pushToken = data;
    return true;
  } catch {
    pushToken = null;
    return false;
  }
}

export async function forgetDevicePushToken(session: Session, onRefresh: OnRefresh) {
  if (!pushToken) return;
  const token = pushToken;
  pushToken = null;
  await unregisterPushToken(session, token, onRefresh);
}

/**
 * Fallback when server push is unavailable: schedules a local notification at each of the user's
 * own upcoming payment reminders. Replaces anything previously scheduled for payments.
 */
export async function scheduleLocalPaymentReminders(payments: Payment[], userId: string, t: Translate, money: (amount: string, currency: string) => string) {
  if (!notificationsSupported) return 0;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return 0;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled.filter((item) => item.content.data?.paymentId).map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );

  const now = Date.now();
  // iOS keeps at most 64 pending local notifications per app.
  const upcoming = payments
    .filter((p) => p.state === 'ACTIVE' && p.assignee.id === userId && p.reminderEnabled && p.reminderAt && new Date(p.reminderAt).getTime() > now)
    .sort((a, b) => a.reminderAt!.localeCompare(b.reminderAt!))
    .slice(0, 60);

  for (const payment of upcoming) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: t('paymentReminderTitle'),
        body: t('paymentReminderBody', { name: payment.name, amount: money(payment.amount, payment.currency) }),
        sound: true,
        data: { paymentId: payment.id, url: `/payment/${payment.id}` },
        ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : {}),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(payment.reminderAt!) },
    });
  }
  return upcoming.length;
}

export async function cancelLocalPaymentReminders() {
  if (!notificationsSupported) return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled.filter((item) => item.content.data?.paymentId).map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
  );
}

export async function sendTestNotification(t: Translate) {
  if (!(await ensureNotificationPermission())) return false;
  await Notifications.scheduleNotificationAsync({
    content: { title: t('testNotifTitle'), body: t('testNotifBody'), sound: true, data: { test: true, url: '/notifications' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5 },
  });
  return true;
}
