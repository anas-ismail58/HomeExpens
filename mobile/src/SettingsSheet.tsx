import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { Text } from './typography';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiBaseUrl } from './api';
import { Card, ConfirmDeleteButton, GradientHero, IconBubble, SectionTitle, SegmentedControl, type IconName } from './components';
import type { Language, StringKey } from './i18n';
import { DISPLAY_CURRENCIES, convert, useFormat, usePreferences, useStyles, type DisplayCurrency, type ThemePreference } from './preferences';
import { router, type Href } from 'expo-router';
import { useNotifications } from './NotificationsContext';
import { useCan, useSession } from './SessionContext';
import type { Tone } from './theme';

type Health = { kind: 'checking' } | { kind: 'ok'; latencyMs: number } | { kind: 'db-down' } | { kind: 'offline' };

async function checkHealth(): Promise<Health> {
  try {
    const response = await fetch(`${apiBaseUrl()}/health`);
    const payload = (await response.json().catch(() => ({}))) as { success?: boolean; code?: string; data?: { latencyMs?: number } };
    if (response.ok && payload.success) return { kind: 'ok', latencyMs: payload.data?.latencyMs ?? 0 };
    return payload.code === 'DB_UNAVAILABLE' ? { kind: 'db-down' } : { kind: 'offline' };
  } catch {
    return { kind: 'offline' };
  }
}

/** Settings presented as a bottom sheet over the current page. */
export function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { session, signOut } = useSession();
  const { t, colors, language, setLanguage, themePreference, setThemePreference, displayCurrency, setDisplayCurrency, rates } = usePreferences();
  const format = useFormat();
  const insets = useSafeAreaInsets();
  const [health, setHealth] = useState<Health>({ kind: 'checking' });
  const { unreadCount } = useNotifications();
  const can = useCan();
  const go = (href: Href) => {
    onClose();
    router.push(href);
  };

  const recheck = () => {
    setHealth({ kind: 'checking' });
    void checkHealth().then(setHealth);
  };

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void checkHealth().then((result) => active && setHealth(result));
    return () => {
      active = false;
    };
  }, [visible]);

  const s = useStyles((c, d) => ({
    backdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: c.overlay },
    sheet: { maxHeight: '88%' as const, backgroundColor: c.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' as const },
    handle: { alignSelf: 'center' as const, width: 44, height: 5, borderRadius: 3, backgroundColor: c.border, marginTop: 10 },
    header: { flexDirection: d.row, alignItems: 'center' as const, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 6 },
    title: { flex: 1, color: c.text, fontSize: 22, fontWeight: '800' as const, textAlign: d.start },
    close: { width: 38, height: 38, borderRadius: 19, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.surfaceMuted },
    content: { paddingHorizontal: 18, paddingTop: 8, gap: 18 },
    profile: { flexDirection: d.row, alignItems: 'center' as const, gap: 14 },
    avatar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(255,255,255,0.22)' },
    avatarText: { color: c.heroText, fontSize: 22, fontWeight: '800' as const },
    profileName: { color: c.heroText, fontSize: 18, fontWeight: '800' as const, textAlign: d.start },
    profileEmail: { color: c.heroMuted, fontSize: 13, marginTop: 3, textAlign: d.start },
    label: { color: c.textSecondary, fontSize: 13, fontWeight: '700' as const, textAlign: d.start, marginBottom: 8 },
    hint: { color: c.muted, fontSize: 12, lineHeight: 18, textAlign: d.start, marginTop: 10 },
    rate: { color: c.text, fontSize: 13, fontWeight: '700' as const, textAlign: d.start, marginTop: 6 },
    section: { gap: 10 },
    recheck: { width: 34, height: 34, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
  }));

  const baseCurrency = session?.family.currency ?? 'EGP';
  const otherCurrency = displayCurrency === baseCurrency ? DISPLAY_CURRENCIES.find((code) => code !== baseCurrency) ?? 'SAR' : displayCurrency;
  const oneUnit = convert(1, otherCurrency, baseCurrency, rates);
  const checking = health.kind === 'checking';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel={t('close')} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.title}>{t('settingsTitle')}</Text>
            <Pressable onPress={onClose} style={s.close} accessibilityLabel={t('close')}>
              <Ionicons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 24 }]}>
            {session ? (
              <GradientHero style={{ padding: 16 }}>
                <View style={s.profile}>
                  <View style={s.avatar}><Text style={s.avatarText}>{session.user.name.trim().charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.profileName}>{session.user.name}</Text>
                    <Text style={s.profileEmail}>{session.family.name} · {session.user.email}</Text>
                  </View>
                </View>
              </GradientHero>
            ) : null}

            <View style={s.section}>
              <SectionTitle title={t('displayCurrency')} />
              <Card>
                <SegmentedControl<DisplayCurrency>
                  value={displayCurrency}
                  onChange={setDisplayCurrency}
                  options={DISPLAY_CURRENCIES.map((code) => ({ value: code, label: code === 'EGP' ? (language === 'ar' ? 'جنيه مصري EGP' : 'EGP · Egyptian pound') : (language === 'ar' ? 'ريال سعودي SAR' : 'SAR · Saudi riyal') }))}
                />
                {rates && oneUnit !== null ? (
                  <>
                    <Text style={s.rate}>{`\u2068${format.rawMoney(1, otherCurrency)}\u2069 = \u2068${format.rawMoney(oneUnit, baseCurrency)}\u2069`}</Text>
                    <Text style={s.hint}>{t('ratesUpdated', { date: format.fullDate(new Date(rates.updatedAt)) })} · {rates.source}</Text>
                  </>
                ) : (
                  <Text style={s.hint}>{t('ratesUnavailable')}</Text>
                )}
                <Text style={s.hint}>{t('displayCurrencyHint', { base: baseCurrency })}</Text>
              </Card>
            </View>

            {session ? (
              <Card padded={false} style={{ paddingHorizontal: 14 }}>
                <Pressable onPress={() => go('/notifications')} accessibilityRole="button">
                  <Row icon="notifications" tone="rose" label={t('notifications')} value={unreadCount ? format.number(unreadCount) : ''} chevron />
                </Pressable>
                <Pressable onPress={() => go('/family')} accessibilityRole="button">
                  <Row icon="people" tone="indigo" label={session.user.isAdmin ? t('familyAndPermissions') : t('familyMembers')} value="" divider chevron />
                </Pressable>
                {can('VIEW_INCOME') ? (
                  <Pressable onPress={() => go('/salary')} accessibilityRole="button">
                    <Row icon="wallet" tone="teal" label={t('salaryBudget')} value="" divider chevron />
                  </Pressable>
                ) : null}
                {can('VIEW_REPORTS') ? (
                  <Pressable onPress={() => go('/analytics')} accessibilityRole="button">
                    <Row icon="pie-chart" tone="violet" label={t('reports')} value="" divider chevron />
                  </Pressable>
                ) : null}
                <Pressable onPress={() => go('/profile')} accessibilityRole="button">
                  <Row icon="person-circle" tone="teal" label={t('profile')} value={t(`role${session.user.role}` as StringKey)} divider chevron />
                </Pressable>
              </Card>
            ) : null}

            <View style={s.section}>
              <SectionTitle title={t('appearance')} />
              <Card>
                <SegmentedControl<ThemePreference>
                  value={themePreference}
                  onChange={setThemePreference}
                  options={[
                    { value: 'light', label: t('themeLight') },
                    { value: 'dark', label: t('themeDark') },
                    { value: 'system', label: t('themeSystem') },
                  ]}
                />
                <Text style={[s.label, { marginTop: 16 }]}>{t('language')}</Text>
                <SegmentedControl<Language>
                  value={language}
                  onChange={setLanguage}
                  options={[
                    { value: 'ar', label: 'العربية' },
                    { value: 'en', label: 'English' },
                  ]}
                />
              </Card>
            </View>

            {session ? (
              <View style={s.section}>
                <SectionTitle title={t('family')} />
                <Card padded={false} style={{ paddingHorizontal: 14 }}>
                  <Row icon="people" tone="indigo" label={t('familyName')} value={session.family.name} />
                  <Row icon="cash" tone="amber" label={t('currency')} value={session.family.currency} divider />
                  <Row icon="time" tone="teal" label={t('timezone')} value={session.user.timezone} divider />
                </Card>
              </View>
            ) : null}

            <View style={s.section}>
              <SectionTitle
                title={t('connection')}
                action={
                  <Pressable onPress={recheck} disabled={checking} accessibilityLabel={t('recheck')} style={s.recheck}>
                    {checking ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="refresh" size={18} color={colors.primary} />}
                  </Pressable>
                }
              />
              <Card padded={false} style={{ paddingHorizontal: 14 }}>
                <StatusRow label={t('server')} ok={health.kind === 'ok' || health.kind === 'db-down'} checking={checking} />
                <StatusRow label={t('database')} ok={health.kind === 'ok'} checking={checking} divider />
                {health.kind === 'ok' ? <Row icon="speedometer" tone="violet" label={t('latency')} value={t('ms', { value: format.number(health.latencyMs) })} divider /> : null}
              </Card>
            </View>

            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              <Row icon="information-circle" tone="rose" label={t('version')} value="2.0.0" />
            </Card>

            <ConfirmDeleteButton label={t('signOut')} question={t('signOutQuestion')} onConfirm={async () => { onClose(); await signOut(); }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Row({ icon, tone, label, value, divider = false, chevron = false }: { icon: IconName; tone: Tone; label: string; value: string; divider?: boolean; chevron?: boolean }) {
  const { colors, rtl } = usePreferences();
  const s = useStyles((c, d) => ({
    row: { minHeight: 56, flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    label: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    value: { flex: 1, color: c.muted, fontSize: 14, textAlign: d.end },
  }));
  return (
    <View style={[s.row, divider && s.divider]}>
      <IconBubble name={icon} color={colors.tones[tone].icon} background={colors.tones[tone].from} size={34} />
      <Text style={s.label}>{label}</Text>
      <Text style={s.value} numberOfLines={1}>{value}</Text>
      {chevron ? <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.muted} /> : null}
    </View>
  );
}

function StatusRow({ label, ok, checking, divider = false }: { label: string; ok: boolean; checking: boolean; divider?: boolean }) {
  const { t, colors } = usePreferences();
  const color = checking ? colors.muted : ok ? colors.success : colors.danger;
  const soft = checking ? colors.surfaceMuted : ok ? colors.successSoft : colors.dangerSoft;
  const s = useStyles((c, d) => ({
    row: { minHeight: 56, flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    label: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
    pillText: { fontSize: 12, fontWeight: '700' as const },
  }));
  return (
    <View style={[s.row, divider && s.divider]}>
      <IconBubble name={checking ? 'ellipsis-horizontal' : ok ? 'checkmark' : 'alert'} color={color} background={soft} size={34} />
      <Text style={s.label}>{label}</Text>
      <View style={[s.pill, { backgroundColor: soft }]}>
        <Text style={[s.pillText, { color }]}>{checking ? t('checking') : ok ? t('connected') : t('disconnected')}</Text>
      </View>
    </View>
  );
}
