import { Ionicons } from '@expo/vector-icons';
import { router, usePathname, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, Modal, Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, GradientHero, IconBubble, SectionTitle, SegmentedControl, type IconName } from './components';
import type { Language, StringKey } from './i18n';
import { usePreferences, useStyles, type ThemePreference } from './preferences';
import { useSession } from './SessionContext';
import type { Tone } from './theme';
import { Text } from './typography';

/** Bottom navigation of the kids' points app: the children, and "More" (settings, sign out). */
export function KidsBar() {
  const { t, colors } = usePreferences();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const s = useStyles((c, d) => ({
    bar: { flexDirection: d.row, backgroundColor: c.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: c.hairline, paddingTop: 8, paddingHorizontal: 6, boxShadow: `0 -4px 18px ${c.shadow}` },
    item: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 3, minHeight: 54 },
    pill: { width: 52, height: 30, borderRadius: 15, alignItems: 'center' as const, justifyContent: 'center' as const },
    pillActive: { backgroundColor: c.primarySoft },
    label: { fontSize: 11, lineHeight: 15, fontWeight: '600' as const, color: c.muted },
    labelActive: { color: c.primary, fontWeight: '800' as const },
  }));
  const kidsActive = !open && pathname.startsWith('/kids');
  const item = (key: string, label: StringKey, icon: IconName, activeIcon: IconName, active: boolean, onPress: () => void) => (
    <Pressable key={key} style={({ pressed }) => [s.item, pressed && { opacity: 0.7 }]} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={t(label)} onPress={onPress}>
      <View style={[s.pill, active && s.pillActive]}>
        <Ionicons name={active ? activeIcon : icon} size={22} color={active ? colors.primary : colors.muted} />
      </View>
      <Text style={[s.label, active && s.labelActive]} numberOfLines={1}>{t(label)}</Text>
    </Pressable>
  );
  return (
    <>
      <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {item('kids', 'menuKids', 'happy-outline', 'happy', kidsActive, () => router.navigate('/kids'))}
        {item('more', 'tabMore', 'menu-outline', 'menu', open, () => setOpen(true))}
      </View>
      <KidsSheet visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Wraps a kids-app page so its bottom bar stays visible under the content. */
export function WithKidsBar({ children }: { children: ReactNode }) {
  const { colors } = usePreferences();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ flex: 1 }}>{children}</View>
      <KidsBar />
    </View>
  );
}

/** Profile, the father's pages (rules, change log), language, appearance and sign out. */
function KidsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { session, signOut } = useSession();
  const { t, colors, language, setLanguage, themePreference, setThemePreference } = usePreferences();
  const insets = useSafeAreaInsets();
  const s = useStyles((c, d) => ({
    backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: c.overlay },
    sheet: { maxHeight: '88%' as const, backgroundColor: c.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' as const },
    handle: { alignSelf: 'center' as const, width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, marginTop: 10 },
    header: { flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 6 },
    title: { color: c.text, fontSize: 20, fontWeight: '800' as const, textAlign: d.start },
    close: { width: 38, height: 38, borderRadius: 19, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.surfaceMuted },
    content: { paddingHorizontal: 18, gap: 16 },
    name: { color: c.heroText, fontSize: 17, fontWeight: '800' as const, textAlign: d.start },
    sub: { color: c.heroMuted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    row: { minHeight: 52, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowLabel: { flex: 1, color: c.text, fontSize: 15, fontWeight: '600' as const, textAlign: d.start },
    label: { color: c.textSecondary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start, marginBottom: 8 },
    signOut: { minHeight: 50, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.dangerSoft },
    signOutText: { color: c.danger, fontSize: 15, fontWeight: '800' as const },
  }));
  const go = (href: Href) => {
    onClose();
    router.push(href);
  };
  const isAdmin = Boolean(session?.user.isAdmin);
  const rows: { label: StringKey; icon: IconName; tone: Tone; onPress: () => void; show: boolean }[] = [
    { label: 'menuKids', icon: 'happy', tone: 'amber', onPress: () => go('/kids'), show: true },
    { label: 'kSettings', icon: 'options', tone: 'violet', onPress: () => go('/kids/settings'), show: isAdmin },
    { label: 'kAudit', icon: 'document-text', tone: 'indigo', onPress: () => go('/kids/audit'), show: isAdmin },
    { label: 'openExpensesApp', icon: 'wallet', tone: 'teal', onPress: () => void (Platform.OS === 'web' ? Linking.openURL('/') : Linking.openURL('familyexpenses://').catch(() => Linking.openURL('https://home-expens-family.vercel.app'))), show: session?.user.role !== 'CHILD' },
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t('close')} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>{t('moreTitle')}</Text>
            <Pressable onPress={onClose} style={s.close} accessibilityLabel={t('close')}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 24 }]} showsVerticalScrollIndicator={false}>
            {session ? (
              <GradientHero style={{ padding: 16 }}>
                <Text style={s.name}>{session.user.name}</Text>
                <Text style={s.sub}>{session.family.name} · {t(`role${session.user.role}` as StringKey)}</Text>
              </GradientHero>
            ) : null}
            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              {rows.filter((r) => r.show).map((r, index) => (
                <Pressable key={r.label} onPress={r.onPress} style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && { opacity: 0.7 }]} accessibilityRole="button">
                  <IconBubble name={r.icon} color={colors.tones[r.tone].icon} background={colors.tones[r.tone].from} size={36} />
                  <Text style={s.rowLabel}>{t(r.label)}</Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                </Pressable>
              ))}
            </Card>
            <View>
              <SectionTitle title={t('appearance')} />
              <Card style={{ gap: 12 }}>
                <SegmentedControl<ThemePreference>
                  value={themePreference}
                  onChange={setThemePreference}
                  options={[{ value: 'light', label: t('themeLight') }, { value: 'dark', label: t('themeDark') }, { value: 'system', label: t('themeSystem') }]}
                />
                <SegmentedControl<Language> value={language} onChange={setLanguage} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
              </Card>
            </View>
            {session ? (
              <Pressable onPress={() => { onClose(); void signOut(); }} style={({ pressed }) => [s.signOut, pressed && { opacity: 0.8 }]} accessibilityRole="button">
                <Text style={s.signOutText}>{t('signOut')}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
