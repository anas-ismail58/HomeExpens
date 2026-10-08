import { Ionicons } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { IconName } from './components';
import type { StringKey } from './i18n';
import { useNotifications } from './NotificationsContext';
import { useFormat, usePreferences, useStyles } from './preferences';
import { useCan } from './SessionContext';
import { SettingsSheet } from './SettingsSheet';

type Item = { key: string; label: StringKey; icon: IconName; activeIcon: IconName; href?: Href };

const START: Item[] = [
  { key: 'home', label: 'tabHome', icon: 'home-outline', activeIcon: 'home', href: '/' },
  { key: 'services', label: 'tabServices', icon: 'grid-outline', activeIcon: 'grid', href: '/services' },
];
const END: Item[] = [
  { key: 'payments', label: 'tabPayments', icon: 'calendar-outline', activeIcon: 'calendar', href: '/payments' },
  { key: 'settings', label: 'tabMore', icon: 'menu-outline', activeIcon: 'menu' },
];

/**
 * App-wide bottom navigation. Used as the tab bar and also rendered at the bottom of
 * pushed pages (details, child, create) so navigation is always one tap away.
 * "More" opens a bottom sheet (notifications, family, reports, profile, settings).
 * The centre button adds an expense, or a payment for members who can only add payments.
 */
export function BottomBar() {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const can = useCan();
  const { unreadCount } = useNotifications();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const canAddExpense = can('ADD_EXPENSE') && (can('SERVICE_LESSONS') || can('SERVICE_HOUSEHOLD'));
  const fabTarget = canAddExpense ? (can('SERVICE_LESSONS') ? '/create/lesson' : '/create/household') : can('ADD_PAYMENT') ? '/payment/new' : null;

  const isActive = (item: Item) =>
    item.key === 'settings' ? settingsOpen : item.href === '/' ? pathname === '/' : pathname === item.href;

  const s = useStyles((c, d) => ({
    bar: {
      flexDirection: d.row,
      alignItems: 'flex-start' as const,
      backgroundColor: c.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      borderTopWidth: 1,
      borderColor: c.hairline,
      paddingTop: 8,
      paddingHorizontal: 6,
      boxShadow: `0 -4px 18px ${c.shadow}`,
    },
    item: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 3, minHeight: 54 },
    pill: { width: 52, height: 30, borderRadius: 15, alignItems: 'center' as const, justifyContent: 'center' as const },
    pillActive: { backgroundColor: c.primarySoft },
    label: { fontSize: 11, lineHeight: 15, fontWeight: '600' as const, color: c.muted },
    labelActive: { color: c.primary, fontWeight: '800' as const },
    center: { flex: 1, alignItems: 'center' as const },
    badge: { position: 'absolute' as const, top: -4, right: 4, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.danger, borderWidth: 2, borderColor: c.surface },
    badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' as const },
    fab: { width: 58, height: 58, borderRadius: 29, marginTop: -26, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 4, borderColor: c.surface, overflow: 'hidden' as const, boxShadow: `0 6px 16px ${c.shadow}` },
  }));

  const renderItem = (item: Item) => {
    const active = isActive(item);
    return (
      <Pressable
        key={item.key}
        style={({ pressed }) => [s.item, pressed && { opacity: 0.7 }]}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        accessibilityLabel={item.key === 'settings' && unreadCount ? `${t(item.label)} · ${unreadCount}` : t(item.label)}
        onPress={() => (item.href ? router.navigate(item.href) : setSettingsOpen(true))}
      >
        <View style={[s.pill, active && s.pillActive]}>
          <Ionicons name={active ? item.activeIcon : item.icon} size={22} color={active ? colors.primary : colors.muted} />
          {item.key === 'settings' && unreadCount > 0 ? (
            <View style={s.badge}><Text style={s.badgeText}>{unreadCount > 9 ? '9+' : format.number(unreadCount)}</Text></View>
          ) : null}
        </View>
        <Text style={[s.label, active && s.labelActive]} numberOfLines={1}>{t(item.label)}</Text>
      </Pressable>
    );
  };

  return (
    <>
      <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {START.map(renderItem)}
        <View style={s.center}>
          {fabTarget ? (
            <Pressable onPress={() => router.navigate(fabTarget)} accessibilityLabel={t('newEntry')} style={({ pressed }) => [s.fab, pressed && { opacity: 0.85 }]}>
              <LinearGradient colors={[colors.heroFrom, colors.heroTo]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
              <Ionicons name="add" size={30} color={colors.heroText} />
            </Pressable>
          ) : null}
        </View>
        {END.map(renderItem)}
      </View>
      <SettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}

/** Wraps a pushed page so the bottom bar stays visible under its content. */
export function WithBottomBar({ children }: { children: React.ReactNode }) {
  const { colors } = usePreferences();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>{children}</View>
      <BottomBar />
    </View>
  );
}
