import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { getNotifications, getPayments } from './api';
import {
  cancelLocalPaymentReminders,
  notificationsSupported,
  registerDeviceForPush,
  scheduleLocalPaymentReminders,
} from './notifications';
import { useFormat, usePreferences } from './preferences';
import { useSession } from './SessionContext';

type Permission = 'granted' | 'denied' | 'undetermined' | 'unsupported';
/** push = server push via Expo; local = on-device scheduled reminders (no push available); off = no permission. */
type Delivery = 'push' | 'local' | 'off';

type NotificationsValue = {
  unreadCount: number;
  permission: Permission;
  delivery: Delivery;
  /** Re-reads the unread badge count. */
  reload: () => Promise<void>;
  refreshPermission: () => Promise<void>;
  /** Re-registers push or reschedules local reminders after payments change. */
  syncDevice: () => Promise<void>;
};

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { session, call } = useSession();
  const { t, language, displayCurrency } = usePreferences();
  const format = useFormat();
  const [unreadCount, setUnreadCount] = useState(0);
  const [permission, setPermission] = useState<Permission>(notificationsSupported ? 'undetermined' : 'unsupported');
  const [delivery, setDelivery] = useState<Delivery>('off');
  const userId = session?.user.id ?? null;

  const refreshPermission = useCallback(async () => {
    if (!notificationsSupported) return;
    const status = await Notifications.getPermissionsAsync();
    setPermission(status.granted ? 'granted' : status.canAskAgain ? 'undetermined' : 'denied');
  }, []);

  const reload = useCallback(async () => {
    if (!userId) return;
    try {
      const { unreadCount: count } = await call(getNotifications);
      setUnreadCount(count);
    } catch {
      // The badge just keeps its last value.
    }
  }, [call, userId]);

  const syncDevice = useCallback(async () => {
    if (!userId || !notificationsSupported) return;
    const status = await Notifications.getPermissionsAsync();
    if (!status.granted) {
      setDelivery('off');
      return;
    }
    if (await call((s, r) => registerDeviceForPush(s, r))) {
      // The server sends reminders even when the app is closed; avoid duplicates from local ones.
      await cancelLocalPaymentReminders();
      setDelivery('push');
      return;
    }
    const payments = await call((s, r) => getPayments(s, r, 'OPEN'));
    await scheduleLocalPaymentReminders(payments, userId, t, (amount, currency) => format.money(amount, currency));
    setDelivery('local');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, userId, language, displayCurrency]);

  useEffect(() => {
    if (!userId) return;
    // Defer a tick so no state update happens synchronously inside the effect.
    void Promise.resolve().then(() => Promise.all([reload(), refreshPermission()]));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void reload();
        void refreshPermission();
      }
    });
    return () => subscription.remove();
  }, [refreshPermission, reload, userId]);

  useEffect(() => {
    if (!userId || permission !== 'granted') return;
    void Promise.resolve().then(syncDevice).catch(() => undefined);
  }, [permission, syncDevice, userId]);

  // Tapping a notification opens the related page.
  useEffect(() => {
    if (!notificationsSupported) return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === 'string' && userId) router.push(url as '/notifications');
      void reload();
    });
    return () => subscription.remove();
  }, [reload, userId]);

  const value = useMemo(
    () => ({ unreadCount: userId ? unreadCount : 0, permission, delivery: userId ? delivery : 'off', reload, refreshPermission, syncDevice }),
    [delivery, permission, refreshPermission, reload, syncDevice, unreadCount, userId],
  );
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error('useNotifications must be used inside NotificationsProvider');
  return value;
}
