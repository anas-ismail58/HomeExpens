import { Stack, router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../typography';
import { deleteNotification, getNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification, type NotificationType } from '../api';
import { WithBottomBar } from '../BottomBar';
import { Card, EmptyState, IconBubble, InlineDelete, ListSkeleton, SmallButton, ToneCard, type IconName } from '../components';
import { useNotifications } from '../NotificationsContext';
import { ensureNotificationPermission, notificationsSupported, sendTestNotification } from '../notifications';
import { usePreferences, useStyles } from '../preferences';
import { useSession } from '../SessionContext';
import type { Tone } from '../theme';

const TYPE_META: Record<NotificationType, { icon: IconName; tone: Tone }> = {
  PAYMENT_REMINDER: { icon: 'alarm', tone: 'violet' },
  PAYMENT_OVERDUE: { icon: 'alert-circle', tone: 'rose' },
  INVITATION: { icon: 'mail', tone: 'teal' },
  PERMISSION_CHANGE: { icon: 'key', tone: 'amber' },
  FAMILY_EVENT: { icon: 'people', tone: 'indigo' },
};

export default function NotificationsPage() {
  return (
    <WithBottomBar>
      <NotificationsScreen />
    </WithBottomBar>
  );
}

function NotificationsScreen() {
  const { call, refreshAccount } = useSession();
  const { t, colors, locale } = usePreferences();
  const { reload: reloadBadge, permission, delivery, refreshPermission, syncDevice } = useNotifications();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await call(getNotifications);
      setItems(result.items);
      setUnread(result.unreadCount);
      void reloadBadge();
      // A permission change may have just arrived: pick it up so the UI matches.
      if (result.items.some((item) => !item.isRead && item.type === 'PERMISSION_CHANGE')) void refreshAccount();
    } finally {
      setLoading(false);
    }
  }, [call, refreshAccount, reloadBadge]);

  useFocusEffect(useCallback(() => { void load().catch(() => undefined); }, [load]));

  const open = async (item: AppNotification) => {
    if (!item.isRead) {
      setItems((list) => list.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
      setUnread((count) => Math.max(0, count - 1));
      void call((s, r) => markNotificationRead(s, item.id, r)).then(reloadBadge).catch(() => undefined);
    }
    if (item.url !== '/notifications') router.push(item.url as Href);
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    row: { flexDirection: d.row, alignItems: 'flex-start' as const, gap: 12, paddingVertical: 12 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    info: { flex: 1, minWidth: 0, gap: 3 },
    title: { color: c.text, fontSize: 14, fontWeight: '700' as const, textAlign: d.start },
    unreadTitle: { fontWeight: '800' as const },
    message: { color: c.textSecondary, fontSize: 13, lineHeight: 19, textAlign: d.start },
    time: { color: c.muted, fontSize: 11, textAlign: d.start },
    dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: c.primary, marginTop: 6 },
    statusRow: { flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    statusText: { flex: 1, fontSize: 13, fontWeight: '700' as const, lineHeight: 19, textAlign: d.start },
    actions: { flexDirection: d.row, gap: 8, marginTop: 12, flexWrap: 'wrap' as const },
    notice: { fontSize: 12, textAlign: d.start, marginTop: 8 },
  }));

  const tone: Tone = permission === 'granted' ? 'teal' : 'rose';
  const statusText = !notificationsSupported
    ? t('notificationsWebOnly')
    : permission !== 'granted'
      ? permission === 'denied' ? t('notificationsDenied') : t('notificationsOff')
      : delivery === 'push' ? t('deliveryPush') : t('deliveryLocal');

  return (
    <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().catch(() => undefined).finally(() => setRefreshing(false)); }} />}
    >
      <Stack.Screen
        options={{
          title: t('notifications'),
          headerRight: unread
            ? () => <SmallButton label={t('markAllRead')} icon="checkmark-done" onPress={() => void call(markAllNotificationsRead).then(load).catch(() => undefined)} />
            : undefined,
        }}
      />

      <ToneCard tone={tone}>
        <View style={s.statusRow}>
          <IconBubble name={permission === 'granted' ? 'notifications' : 'notifications-off'} color={colors.tones[tone].icon} background={colors.tones[tone].bubble} size={42} />
          <Text style={[s.statusText, { color: colors.tones[tone].fg }]}>{statusText}</Text>
        </View>
        {notificationsSupported && permission !== 'denied' ? (
          <View style={s.actions}>
            {permission !== 'granted' ? (
              <SmallButton
                label={t('enableNotifications')}
                icon="notifications"
                onPress={() => void ensureNotificationPermission().then(refreshPermission).then(syncDevice).catch(() => undefined)}
              />
            ) : null}
            <SmallButton
              label={t('sendTest')}
              icon="paper-plane"
              onPress={() => void sendTestNotification(t).then(async (sent) => { await refreshPermission(); setNotice(sent ? t('testSent') : t('notificationsDenied')); })}
            />
          </View>
        ) : null}
        {notice ? <Text style={[s.notice, { color: colors.tones[tone].fg }]}>{notice}</Text> : null}
      </ToneCard>

      <Card padded={false} style={{ paddingHorizontal: 14 }}>
        {loading ? <ListSkeleton rows={4} /> : items.length ? items.map((item, index) => {
          const meta = TYPE_META[item.type];
          return (
            <Pressable key={item.id} onPress={() => void open(item)} style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && { opacity: 0.75 }]} accessibilityRole="button">
              <IconBubble name={meta.icon} color={colors.tones[meta.tone].icon} background={colors.tones[meta.tone].from} />
              <View style={s.info}>
                <Text style={[s.title, !item.isRead && s.unreadTitle]}>{item.title}</Text>
                <Text style={s.message}>{item.message}</Text>
                <Text style={s.time}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.createdAt))}</Text>
              </View>
              {!item.isRead ? <View style={s.dot} accessibilityLabel="unread" /> : null}
              <InlineDelete label={item.title} onConfirm={async () => { await call((sess, r) => deleteNotification(sess, item.id, r)); await load(); }} />
            </Pressable>
          );
        }) : <EmptyState icon="notifications-outline" title={t('noNotifications')} body={t('noNotificationsBody')} />}
      </Card>
    </ScrollView>
  );
}
