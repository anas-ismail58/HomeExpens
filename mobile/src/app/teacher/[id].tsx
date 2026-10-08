import { Ionicons } from '@expo/vector-icons';
import { Stack, router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { getTeacherProfile, type TeacherProfile } from '../../api';
import { WithBottomBar } from '../../BottomBar';
import { Card, EmptyState, GradientHero, IconBubble, ListSkeleton, SectionTitle, Skeleton, SmallButton } from '../../components';
import type { StringKey } from '../../i18n';
import { CountUp, FadeInView } from '../../motion';
import { totalsOf, useToDisplayCurrency } from '../../paymentFormat';
import { PaymentRow } from '../../PaymentViews';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { useSubjectLabel } from '../../subjects';
import { TeacherContact } from '../../teachers';
import { Text } from '../../typography';

export default function TeacherPage() {
  return (
    <WithBottomBar>
      <TeacherScreen />
    </WithBottomBar>
  );
}

/** One teacher: how to reach them, what their lessons cost, and every payment that goes to them. */
function TeacherScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call } = useAuthedSession();
  const { t, colors, rtl } = usePreferences();
  const format = useFormat();
  const can = useCan();
  const subjectLabel = useSubjectLabel();
  const { currency: displayCurrency, toCurrency } = useToDisplayCurrency();
  const [teacher, setTeacher] = useState<TeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      setTeacher(await call((s, r) => getTeacherProfile(s, id, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [call, id, t]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    heroLabel: { color: c.heroMuted, fontSize: 13, fontWeight: '600' as const, textAlign: d.start },
    heroAmount: { color: c.heroText, fontSize: 32, fontWeight: '800' as const, textAlign: d.start, marginTop: 4, fontVariant: ['tabular-nums' as const] },
    heroSub: { color: c.heroMuted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    split: { flexDirection: d.row, gap: 10, marginTop: 14 },
    chip: { flex: 1, minWidth: 0, borderRadius: 14, padding: 12, backgroundColor: 'rgba(255,255,255,0.16)' },
    chipLabel: { color: c.heroMuted, fontSize: 12, textAlign: d.start },
    chipValue: { color: c.heroText, fontSize: 15, fontWeight: '700' as const, marginTop: 4, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    actions: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 8 },
    row: { minHeight: 56, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowLabel: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    rowSub: { color: c.muted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    rowValue: { color: c.text, fontSize: 14, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    hint: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: d.start },
    notice: { color: c.success, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  if (loading) {
    return (
      <View style={[s.screen, s.page]}>
        <Skeleton height={150} radius={24} />
        <Card><ListSkeleton rows={3} /></Card>
      </View>
    );
  }
  if (!teacher) {
    return (
      <View style={[s.screen, s.page, { justifyContent: 'center' }]}>
        <EmptyState icon="alert-circle-outline" title={t('teacherProfile')} body={error || t('loadError')} />
      </View>
    );
  }

  const open = teacher.payments.filter((p) => p.state !== 'CANCELLED');
  const toPay = totalsOf(open, toCurrency);
  const subject = subjectLabel(teacher.subject);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={s.screen}
      contentContainerStyle={s.page}
      refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }} />}
    >
      <Stack.Screen options={{ title: teacher.name }} />

      <FadeInView>
        <GradientHero>
          <Text style={s.heroLabel}>{t('teacherLessonsTotal')}</Text>
          <CountUp value={Number(teacher.lessonsTotal)}>
            {(shown) => <Text style={s.heroAmount} numberOfLines={1} adjustsFontSizeToFit>{format.money(shown, teacher.currency)}</Text>}
          </CountUp>
          <Text style={s.heroSub}>{[t('lessonsCount', { count: format.number(teacher.lessonsCount) }), subject].filter(Boolean).join(' · ')}</Text>
          {open.length ? (
            <View style={s.split}>
              <View style={s.chip}>
                <Text style={s.chipLabel}>{t('willPay')} · {format.number(toPay.toPayCount)}</Text>
                <Text style={s.chipValue} numberOfLines={1}>{format.rawMoney(toPay.toPay, displayCurrency)}</Text>
              </View>
              <View style={s.chip}>
                <Text style={s.chipLabel}>{t('paidPart')} · {format.number(toPay.paidCount)}</Text>
                <Text style={s.chipValue} numberOfLines={1}>{format.rawMoney(toPay.paid, displayCurrency)}</Text>
              </View>
            </View>
          ) : null}
        </GradientHero>
      </FadeInView>

      <FadeInView index={1}>
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          <TeacherContact teacher={teacher} />
        </Card>
      </FadeInView>
      {teacher.removed ? <Text style={s.hint}>{t('teacherRemoved')}</Text> : null}
      {notice ? <Text style={s.notice}>{notice}</Text> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      {!teacher.removed ? (
        <View style={s.actions}>
          {can('ADD_EXPENSE') ? <SmallButton label={t('addTeacherLesson')} icon="add" onPress={() => router.push({ pathname: '/create/[kind]', params: { kind: 'lesson', teacherId: teacher.id } })} /> : null}
          {can('ADD_PAYMENT') ? (
            <SmallButton
              label={t('addTeacherPayment')}
              icon="calendar"
              onPress={() => router.push({ pathname: '/payment/new', params: { category: 'TUITION', teacherId: teacher.id, name: teacher.name } })}
            />
          ) : null}
        </View>
      ) : null}

      {teacher.payments.length ? (
        <FadeInView index={2} style={{ gap: 10 }}>
          <SectionTitle title={t('teacherPayments')} count={teacher.payments.length} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {teacher.payments.map((payment, index) => (
              <PaymentRow key={payment.id} payment={payment} last={index === teacher.payments.length - 1} onChanged={(message) => { setNotice(message); void load(); }} />
            ))}
          </Card>
        </FadeInView>
      ) : null}

      {teacher.fees.length ? (
        <FadeInView index={3} style={{ gap: 10 }}>
          <SectionTitle title={t('teacherFees')} count={teacher.fees.length} />
          <Card padded={false} style={{ paddingHorizontal: 14 }}>
            {teacher.fees.map((fee, index) => (
              <View key={fee.id} style={[s.row, index > 0 && s.divider]}>
                <IconBubble name="repeat" color={colors.lessons} background={colors.lessonsSoft} size={36} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.rowLabel} numberOfLines={1}>{fee.description}</Text>
                  <Text style={s.rowSub} numberOfLines={1}>{[fee.child?.name, subjectLabel(fee.subject), t(`freq_${fee.frequency}` as StringKey)].filter(Boolean).join(' · ')}</Text>
                </View>
                <Text style={s.rowValue}>{format.money(fee.amount, fee.currency)}</Text>
              </View>
            ))}
          </Card>
        </FadeInView>
      ) : null}

      <FadeInView index={4} style={{ gap: 10 }}>
        <SectionTitle title={t('teacherLessons')} count={teacher.lessons.length} />
        <Card padded={false} style={{ paddingHorizontal: 14 }}>
          {teacher.lessons.length ? teacher.lessons.map((lesson, index) => (
            <Pressable
              key={lesson.id}
              onPress={() => router.push(`/expense/${lesson.id}`)}
              style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && { opacity: 0.7 }]}
              accessibilityRole="button"
            >
              <IconBubble name="school" color={colors.lessons} background={colors.lessonsSoft} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.rowLabel} numberOfLines={1}>{[lesson.child?.name, subjectLabel(lesson.subject)].filter(Boolean).join(' · ') || lesson.description || t('teacherLessons')}</Text>
                <Text style={s.rowSub} numberOfLines={1}>{format.date(lesson.date)}</Text>
              </View>
              <Text style={s.rowValue}>{format.money(lesson.amount, lesson.currency)}</Text>
              <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={16} color={colors.muted} />
            </Pressable>
          )) : <Text style={[s.hint, { paddingVertical: 14 }]}>{t('noTeacherLessons')}</Text>}
        </Card>
      </FadeInView>
    </ScrollView>
  );
}
