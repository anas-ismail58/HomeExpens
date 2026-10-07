import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { deleteChild, deleteRecurringFee, getChildDetails, type ChildDetails } from '../../api';
import {
  Card,
  ConfirmDeleteButton,
  EmptyState,
  ExpenseRow,
  GradientHero,
  IconBubble,
  InlineDelete,
  ListSkeleton,
  PrimaryButton,
  SectionTitle,
  Skeleton,
  ToneCard,
} from '../../components';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { WithBottomBar } from '../../BottomBar';
import type { StringKey } from '../../i18n';
import { useAuthedSession, useCan } from '../../SessionContext';
import { thisMonth } from '../../useMonthlyReport';

export default function ChildScreenPage() {
  return (
    <WithBottomBar>
      <ChildScreen />
    </WithBottomBar>
  );
}

function ChildScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, call } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const [child, setChild] = useState<ChildDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const currency = session.family.currency;
  const can = useCan();

  const load = useCallback(async () => {
    try {
      setChild(await call((sess, r) => getChildDetails(sess, id, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, id, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const removeFee = async (feeId: string) => {
    try {
      await call((sess, r) => deleteRecurringFee(sess, feeId, r));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('deleteError'));
    }
  };

  const removeChild = async () => {
    try {
      await call((sess, r) => deleteChild(sess, id, r));
      if (router.canGoBack()) router.back();
      else router.replace('/services');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('deleteError'));
    }
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 18 },
    heroTop: { flexDirection: d.row, alignItems: 'center' as const, gap: 14 },
    avatar: { width: 60, height: 60, borderRadius: 30, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(255,255,255,0.22)' },
    avatarText: { color: c.heroText, fontSize: 26, fontWeight: '800' as const },
    name: { color: c.heroText, fontSize: 22, fontWeight: '800' as const, textAlign: d.start },
    subtitle: { color: c.heroMuted, fontSize: 13, marginTop: 3, textAlign: d.start },
    heroTotalLabel: { color: c.heroMuted, fontSize: 13, marginTop: 18, textAlign: d.start },
    heroTotal: { color: c.heroText, fontSize: 30, fontWeight: '800' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    stats: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 10 },
    stat: { flexGrow: 1, flexBasis: '45%' as const, minWidth: 0, gap: 4 },
    statLabel: { color: c.muted, fontSize: 12, fontWeight: '600' as const, textAlign: d.start },
    statValue: { color: c.text, fontSize: 16, fontWeight: '800' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    statNote: { color: c.muted, fontSize: 11, textAlign: d.start },
    actions: { flexDirection: d.row, gap: 10 },
    secondary: { flex: 1, minHeight: 52, borderRadius: 14, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
    secondaryText: { color: c.primary, fontSize: 15, fontWeight: '700' as const },
    section: { gap: 10 },
    feeRow: { minHeight: 62, flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    feeInfo: { flex: 1, minWidth: 0 },
    feeTitle: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    feeMeta: { color: c.muted, fontSize: 12, marginTop: 3, textAlign: d.start },
    feeAmount: { color: c.text, fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    hint: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 14 },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (loading) {
    return (
      <View style={[s.screen, s.page]}>
        <Skeleton height={170} radius={24} />
        <View style={s.stats}><Skeleton height={80} radius={18} style={{ flex: 1 }} /><Skeleton height={80} radius={18} style={{ flex: 1 }} /></View>
        <Card><ListSkeleton rows={3} /></Card>
      </View>
    );
  }
  if (!child) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="alert-circle-outline" title={t('childNotFound')} body={error || t('maybeDeleted')} />
      </View>
    );
  }

  const month = thisMonth();
  const monthLessons = child.lessons.filter((lesson) => lesson.date.startsWith(month));
  const monthLessonsTotal = monthLessons.reduce((sum, lesson) => sum + Number(lesson.amount), 0);
  const feesTotal = child.recurring.reduce((sum, fee) => sum + Number(fee.amount), 0);
  const allLessonsTotal = child.lessons.reduce((sum, lesson) => sum + Number(lesson.amount), 0);
  const subtitle = [child.grade, child.school].filter(Boolean).join(' · ');

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Stack.Screen options={{ title: child.name }} />

      <GradientHero>
        <View style={s.heroTop}>
          <View style={s.avatar}><Text style={s.avatarText}>{child.name.trim().charAt(0)}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{child.name}</Text>
            {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        <Text style={s.heroTotalLabel}>{t('totalThisMonth')}</Text>
        <Text style={s.heroTotal} numberOfLines={1} adjustsFontSizeToFit>{format.money(monthLessonsTotal + feesTotal, currency)}</Text>
      </GradientHero>

      <View style={s.stats}>
        <ToneCard tone="violet" style={s.stat}>
          <Text style={s.statLabel}>{t('feesPerMonth')}</Text>
          <Text style={s.statValue} numberOfLines={1}>{format.money(feesTotal, currency)}</Text>
        </ToneCard>
        <ToneCard tone="indigo" style={s.stat}>
          <Text style={s.statLabel}>{t('lessonsThisMonth')}</Text>
          <Text style={s.statValue} numberOfLines={1}>{format.money(monthLessonsTotal, currency)}</Text>
          <Text style={s.statNote}>{t('sessions', { count: format.number(monthLessons.length) })}</Text>
        </ToneCard>
        <ToneCard tone="teal" style={s.stat}>
          <Text style={s.statLabel}>{t('allLessons')}</Text>
          <Text style={s.statValue} numberOfLines={1}>{format.money(allLessonsTotal, currency)}</Text>
        </ToneCard>
      </View>

      {can('ADD_EXPENSE') ? <View style={s.actions}>
        <View style={{ flex: 1 }}>
          <PrimaryButton label={t('newLesson')} icon="add" onPress={() => router.push({ pathname: '/create/[kind]', params: { kind: 'lesson', childId: child.id } })} />
        </View>
        <Pressable onPress={() => router.push({ pathname: '/create/[kind]', params: { kind: 'tuition', childId: child.id } })} style={({ pressed }) => [s.secondary, pressed && { opacity: 0.8 }]}>
          <Text style={s.secondaryText}>{t('monthlyFee')}</Text>
        </Pressable>
      </View> : null}

      {error ? <Text style={s.error}>{error}</Text> : null}

      <View style={s.section}>
        <SectionTitle title={t('monthlyFees')} count={child.recurring.length} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {child.recurring.length ? child.recurring.map((fee, index) => (
            <View key={fee.id} style={[s.feeRow, index > 0 && s.divider]}>
              <IconBubble name="repeat" color={colors.lessons} background={colors.lessonsSoft} />
              <View style={s.feeInfo}>
                <Text style={s.feeTitle} numberOfLines={1}>{fee.description}</Text>
                <Text style={s.feeMeta}>{[fee.teacher?.name, t(`freq_${fee.frequency}` as StringKey), t('since', { date: format.date(fee.startDate) })].filter(Boolean).join(' · ')}</Text>
              </View>
              <Text style={s.feeAmount}>{format.money(fee.amount, currency)}</Text>
              {can('ADD_PAYMENT') ? (
                <Pressable
                  hitSlop={6}
                  accessibilityLabel={t('remindMe')}
                  onPress={() => router.push({ pathname: '/payment/new', params: { name: fee.description, amount: fee.amount, category: 'TUITION', memberId: child.id, day: String(Number(fee.startDate.slice(8, 10))) } })}
                  style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Ionicons name="notifications-outline" size={18} color={colors.primary} />
                </Pressable>
              ) : null}
              {can('DELETE_EXPENSE') ? <InlineDelete label={fee.description} onConfirm={() => removeFee(fee.id)} /> : null}
            </View>
          )) : <Text style={s.hint}>{t('noChildFees')}</Text>}
        </Card>
      </View>

      <View style={s.section}>
        <SectionTitle title={t('lessons')} count={child.lessons.length} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {child.lessons.length ? child.lessons.map((lesson, index) => (
            <ExpenseRow key={lesson.id} expense={lesson} currency={currency} last={index === child.lessons.length - 1} onPress={() => router.push(`/expense/${lesson.id}`)} />
          )) : <EmptyState icon="school-outline" title={t('noLessons')} body={t('noLessonsBody')} />}
        </Card>
      </View>

      {can('MANAGE_CHILDREN') ? <ConfirmDeleteButton label={t('deleteChild')} question={t('deleteChildQuestion', { name: child.name })} onConfirm={removeChild} /> : null}
    </ScrollView>
  );
}
