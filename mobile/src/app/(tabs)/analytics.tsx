import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, EmptyState, IconBubble, ScreenHeader, SectionTitle } from '../../components';
import { ErrorCard, LoadingCards, PeriodFilter, RankBars, SeriesBars, SplitBar, StatCard, StatGrid, thisMonthRange, useColumns, useInsights } from '../../insights';
import type { InsightsPeriod } from '../../api';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { Text } from '../../typography';

export default function AnalyticsGate() {
  const can = useCan();
  const { t, colors } = usePreferences();
  if (!can('VIEW_REPORTS')) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 18, backgroundColor: colors.background }}>
        <EmptyState icon="lock-closed-outline" title={t('noAccess')} body={t('noAccessBody')} />
      </View>
    );
  }
  return <AnalyticsScreen />;
}

/** Family spending and lesson payments for a period, as cards and charts. All numbers come from the server. */
function AnalyticsScreen() {
  const { session } = useAuthedSession();
  const { t, colors, locale } = usePreferences();
  const format = useFormat();
  const columns = useColumns();
  const [period, setPeriod] = useState<InsightsPeriod>('month');
  const [range, setRange] = useState(thisMonthRange);
  const { data, error, loading, reload } = useInsights(period, period === 'custom' ? range : undefined);
  const [refreshing, setRefreshing] = useState(false);
  const currency = data?.currency ?? session.family.currency;
  const money = (value: string | number) => format.moneyShort(value, currency);
  const monthName = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
  const dayName = new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' });

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40, gap: 18, width: '100%' as const, maxWidth: 980, alignSelf: 'center' as const },
    twoUp: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 18 },
    half: { flexBasis: columns === 3 ? ('48%' as const) : ('100%' as const), flexGrow: 1, gap: 10 },
    row: { minHeight: 56, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowTitle: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    rowSub: { color: c.muted, fontSize: 12, marginTop: 2, textAlign: d.start },
    rowValue: { color: c.text, fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    empty: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 8 },
  }));

  const totals = data?.totals;
  const dueSoon = totals ? Math.max(0, Number(totals.unpaid.amount) - Number(totals.overdue.amount)) : 0;
  const spendingLabels = (data?.spending ?? []).map((b) => (data?.unit === 'month' ? monthName.format(new Date(`${b.key}-01T00:00:00Z`)) : dayName.format(new Date(`${b.key}T00:00:00Z`))));

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={colors.primary} onRefresh={() => { setRefreshing(true); void reload().finally(() => setRefreshing(false)); }} />}
      >
        <ScreenHeader title={t('tabAnalytics')} subtitle={data ? `${format.date(data.range.from)} – ${format.date(data.range.to)}` : undefined} />
        <PeriodFilter period={period} range={range} onChange={(next, nextRange) => { setPeriod(next); setRange(nextRange); }} />

        {error && !data ? <ErrorCard message={error} onRetry={() => void reload()} /> : !totals ? <LoadingCards /> : (
          <>
            {/* The key numbers first. */}
            <StatGrid>
              <StatCard icon="wallet" tone="indigo" label={t('dashFamilyExpenses')} value={money(totals.expenses)} loading={loading && !data} />
              {totals.lessons != null ? <StatCard icon="school" tone="violet" label={t('dashLessonCosts')} value={money(totals.lessons)} /> : null}
              <StatCard icon="checkmark-circle" tone="teal" label={t('dashPaid')} value={money(totals.paid.amount)} sub={t('dashPaymentsCount', { count: format.number(totals.paid.count) })} />
              <StatCard icon="alert-circle" tone="rose" label={t('dashUnpaid')} value={money(totals.unpaid.amount)} sub={totals.overdue.count ? `${t('dashOverdue')}: ${money(totals.overdue.amount)}` : undefined} />
            </StatGrid>

            <View style={s.twoUp}>
              <View style={s.half}>
                <SectionTitle title={t('chartMonthly')} />
                <Card>
                  <SeriesBars
                    labels={data.trend.map((m) => monthName.format(new Date(`${m.month}-01T00:00:00Z`)))}
                    series={[
                      { label: t('chartAllExpenses'), color: colors.seriesHousehold, values: data.trend.map((m) => Number(m.expenses)) },
                      ...(totals.lessons != null ? [{ label: t('chartLessons'), color: colors.seriesLessons, values: data.trend.map((m) => Number(m.lessons)) }] : []),
                    ]}
                    money={money}
                  />
                </Card>
              </View>
              <View style={s.half}>
                <SectionTitle title={t('chartPaidUnpaid')} />
                <Card>
                  <SplitBar
                    empty={t('noPaymentsInRange')}
                    parts={[
                      { key: 'paid', label: t('dashPaid'), value: Number(totals.paid.amount), display: money(totals.paid.amount), color: colors.success, icon: 'checkmark-circle' },
                      { key: 'due', label: t('dashUnpaid'), value: dueSoon, display: money(dueSoon), color: colors.tones.amber.icon, icon: 'time' },
                      { key: 'overdue', label: t('dashOverdue'), value: Number(totals.overdue.amount), display: money(totals.overdue.amount), color: colors.danger, icon: 'alert-circle' },
                    ]}
                  />
                </Card>
              </View>
            </View>

            <View style={{ gap: 10 }}>
              <SectionTitle title={t('chartTrend')} />
              <Card>
                {data.spending.some((b) => Number(b.expenses) > 0) ? (
                  <SeriesBars labels={spendingLabels} series={[{ label: t('chartAllExpenses'), color: colors.seriesHousehold, values: data.spending.map((b) => Number(b.expenses)) }]} money={money} labelEvery={spendingLabels.length > 12 ? 5 : 1} />
                ) : <Text style={s.empty}>{t('noRecentTransactions')}</Text>}
              </Card>
            </View>

            <View style={s.twoUp}>
              <View style={s.half}>
                <SectionTitle title={t('chartReminders')} count={data.reminders.length} />
                <Card padded={false} style={{ paddingHorizontal: 14 }}>
                  {data.reminders.length ? data.reminders.map((p, index) => (
                    <Pressable key={p.id} onPress={() => router.push(`/payment/${p.id}`)} style={({ pressed }) => [s.row, index > 0 && s.divider, pressed && { opacity: 0.7 }]} accessibilityRole="button">
                      <IconBubble name="alarm" color={colors.tones.violet.icon} background={colors.tones.violet.from} size={36} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.rowTitle} numberOfLines={1}>{p.name}</Text>
                        <Text style={s.rowSub} numberOfLines={1}>{[format.date(p.dueDate), p.child?.name].filter(Boolean).join(' · ')}</Text>
                      </View>
                      <Text style={s.rowValue}>{format.money(p.amount, p.currency)}</Text>
                    </Pressable>
                  )) : <Text style={[s.empty, { paddingVertical: 14 }]}>{t('noReminders')}</Text>}
                </Card>
              </View>
              <View style={s.half}>
                <SectionTitle title={t('chartByChild')} />
                <Card>
                  <RankBars
                    color={colors.seriesLessons}
                    empty={t('noOutstanding')}
                    rows={data.outstanding.byChild.map((r) => ({ key: r.id, label: r.name, value: Number(r.amount), display: money(r.amount), sub: t('dashPaymentsCount', { count: format.number(r.count) }) }))}
                  />
                </Card>
                {totals.lessons != null ? (
                  <>
                    <SectionTitle title={t('chartByTeacher')} />
                    <Card>
                      <RankBars
                        color={colors.seriesLessons}
                        empty={t('noOutstanding')}
                        rows={data.outstanding.byTeacher.map((r) => ({ key: r.id, label: r.name, value: Number(r.amount), display: money(r.amount), sub: t('dashPaymentsCount', { count: format.number(r.count) }) }))}
                      />
                    </Card>
                  </>
                ) : null}
              </View>
            </View>

          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
