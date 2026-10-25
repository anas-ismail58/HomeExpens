import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getChildren, getHouseholdSections, getRecurringFees, getTeachers, type PermissionKey } from '../../api';
import { Card, IconBubble, ScreenHeader, ToneCard, type IconName } from '../../components';
import type { StringKey } from '../../i18n';
import type { Tone } from '../../theme';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { useSubjects } from '../../subjects';
import { FadeInView, PressableScale } from '../../motion';

// Each tile needs the action permission plus the service switch the father controls.
const SERVICES: { kind: string; title: StringKey; body: StringKey; icon: IconName; tone: Tone; needs: PermissionKey[] }[] = [
  { kind: 'lesson', title: 'svcLesson', body: 'svcLessonBody', icon: 'school', tone: 'indigo', needs: ['ADD_EXPENSE', 'SERVICE_LESSONS'] },
  { kind: 'tuition', title: 'svcTuition', body: 'svcTuitionBody', icon: 'repeat', tone: 'violet', needs: ['ADD_EXPENSE', 'SERVICE_RECURRING'] },
  { kind: 'household', title: 'svcHousehold', body: 'svcHouseholdBody', icon: 'home', tone: 'amber', needs: ['ADD_EXPENSE', 'SERVICE_HOUSEHOLD'] },
  { kind: 'child', title: 'svcChild', body: 'svcChildBody', icon: 'person-add', tone: 'teal', needs: ['MANAGE_CHILDREN'] },
];

export default function ServicesScreen() {
  const { call } = useAuthedSession();
  const { t, colors, rtl } = usePreferences();
  const format = useFormat();
  const can = useCan();
  const { subjects, reload: reloadSubjects } = useSubjects();
  const [counts, setCounts] = useState<{ children?: number; teachers?: number; fees?: number; sections?: number }>({});
  const [refreshing, setRefreshing] = useState(false);

  /** Counts shown on each row; a list the member can't see just shows no count. */
  const load = useCallback(async () => {
    const count = async <T,>(enabled: boolean, fetch: () => Promise<T[]>) => (enabled ? fetch().then((list) => list.length).catch(() => undefined) : undefined);
    const [children, teachers, fees, sections] = await Promise.all([
      count(can('SERVICE_LESSONS') || can('MANAGE_CHILDREN'), () => call(getChildren)),
      count(can('SERVICE_LESSONS'), () => call(getTeachers)),
      count(can('SERVICE_RECURRING'), () => call(getRecurringFees)),
      count(can('SERVICE_HOUSEHOLD'), () => call(getHouseholdSections)),
    ]);
    setCounts({ children, teachers, fees, sections });
    void reloadSubjects();
  }, [call, can, reloadSubjects]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40, gap: 22 },
    grid: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 10 },
    serviceWrap: { width: '48%' as const, flexGrow: 1 },
    service: { flex: 1, gap: 8, alignItems: d.alignStart, minHeight: 170 },
    serviceTitle: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start, marginTop: 4 },
    serviceBody: { color: c.muted, fontSize: 12, lineHeight: 17, textAlign: d.start },
    row: { minHeight: 64, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowTitle: { flex: 1, color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: d.start },
    rowHint: { color: c.muted, fontSize: 12, marginTop: 2, textAlign: d.start },
    count: { minWidth: 28, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: c.surfaceMuted, color: c.textSecondary, fontSize: 13, fontWeight: '700' as const, textAlign: 'center' as const, fontVariant: ['tabular-nums' as const] },
  }));

  // Each list has its own page; these rows open them.
  const rows: { href: Href; title: StringKey; hint?: StringKey; icon: IconName; tone: Tone; count?: number; show: boolean }[] = [
    { href: '/payments', title: 'payments', hint: 'paymentsSubtitle', icon: 'calendar', tone: 'rose', show: true },
    { href: '/manage/wallets', title: 'wallets', hint: 'walletsHint', icon: 'wallet', tone: 'teal', show: true },
    { href: '/manage/children', title: 'children', icon: 'people', tone: 'indigo', count: counts.children, show: can('SERVICE_LESSONS') || can('MANAGE_CHILDREN') },
    { href: '/manage/teachers', title: 'teachers', icon: 'person', tone: 'violet', count: counts.teachers, show: can('SERVICE_LESSONS') },
    { href: '/manage/subjects', title: 'subjects', icon: 'book', tone: 'indigo', count: subjects.filter((x) => x.isActive).length || undefined, show: can('SERVICE_LESSONS') },
    { href: '/manage/fees', title: 'monthlyFees', icon: 'repeat', tone: 'violet', count: counts.fees, show: can('SERVICE_RECURRING') },
    { href: '/manage/sections', title: 'householdSections', icon: 'home', tone: 'amber', count: counts.sections, show: can('SERVICE_HOUSEHOLD') },
  ];

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
      >
        <ScreenHeader title={t('tabServices')} subtitle={t('servicesSubtitle')} />

        <View style={s.grid}>
          {SERVICES.filter((service) => service.needs.every(can)).map((service, index) => (
            <FadeInView key={service.kind} index={index} style={s.serviceWrap}>
            <PressableScale style={{ flex: 1 }} onPress={() => router.push(`/create/${service.kind}`)} accessibilityRole="button">
              <ToneCard tone={service.tone} style={s.service}>
                <IconBubble name={service.icon} color={colors.tones[service.tone].icon} background={colors.tones[service.tone].bubble} size={44} />
                <Text style={[s.serviceTitle, { color: colors.tones[service.tone].fg }]}>{t(service.title)}</Text>
                <Text style={[s.serviceBody, { color: colors.tones[service.tone].fg, opacity: 0.8 }]}>{t(service.body)}</Text>
              </ToneCard>
            </PressableScale>
            </FadeInView>
          ))}
        </View>

        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {rows.filter((row) => row.show).map((row, index) => (
            <Pressable key={String(row.href)} onPress={() => router.push(row.href)} style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && { opacity: 0.7 }]} accessibilityRole="button">
              <IconBubble name={row.icon} color={colors.tones[row.tone].icon} background={colors.tones[row.tone].from} size={42} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowTitle} numberOfLines={1}>{t(row.title)}</Text>
                {row.hint ? <Text style={s.rowHint} numberOfLines={1}>{t(row.hint)}</Text> : null}
              </View>
              {row.count !== undefined ? <Text style={s.count}>{format.number(row.count)}</Text> : null}
              <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={18} color={colors.muted} />
            </Pressable>
          ))}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
