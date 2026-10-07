import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, EmptyState, GradientHero, MonthSwitcher, ScreenHeader, SectionTitle, Skeleton, isHousehold } from '../../components';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { shiftMonth, thisMonth, useMonthlyReport } from '../../useMonthlyReport';

type BarDatum = { key: string; label: string; value: number };

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

function AnalyticsScreen() {
  const { session } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const [month, setMonth] = useState(thisMonth);
  const { report, loading, refreshing, error, refresh } = useMonthlyReport(month);
  const currency = report?.currency ?? session.family.currency;
  const money = (value: number | string) => format.money(value, currency);

  const lessons = Number(report?.homeLessons.totalAmount ?? 0);
  const household = Number(report?.household.totalAmount ?? 0);
  const total = lessons + household;

  const perChild = useMemo<BarDatum[]>(
    () =>
      (report?.homeLessons.perChild ?? [])
        .map((child) => ({ key: child.childId, label: child.childName, value: Number(child.totalAmount) }))
        .sort((a, b) => b.value - a.value),
    [report],
  );

  const householdItems = useMemo<BarDatum[]>(() => {
    const groups = new Map<string, BarDatum>();
    for (const expense of report?.expenses ?? []) {
      if (!isHousehold(expense)) continue;
      const key = expense.subcategory?.key ?? 'other';
      const entry = groups.get(key) ?? { key, label: expense.subcategory ? format.name(expense.subcategory) : t('other'), value: 0 };
      entry.value += Number(expense.amount);
      groups.set(key, entry);
    }
    return [...groups.values()].sort((a, b) => b.value - a.value);
  }, [format, report, t]);

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40, gap: 18 },
    heroLabel: { color: c.heroMuted, fontSize: 13, fontWeight: '600' as const, textAlign: d.start },
    heroValue: { color: c.heroText, fontSize: 32, fontWeight: '800' as const, marginTop: 6, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    heroNote: { color: c.heroMuted, fontSize: 12, marginTop: 4, textAlign: d.start },
    section: { gap: 10 },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={colors.primary} />}
      >
        <ScreenHeader title={t('tabAnalytics')} subtitle={t('analyticsSubtitle')} />
        <MonthSwitcher month={month} onChange={(amount) => setMonth((m) => shiftMonth(m, amount))} />
        {error ? <Text style={s.error}>{error}</Text> : null}

        <GradientHero>
          <Text style={s.heroLabel}>{t('monthTotal')}</Text>
          {loading ? <Skeleton height={34} width="55%" style={{ marginTop: 8, backgroundColor: 'rgba(255,255,255,0.2)' }} /> : (
            <Text style={s.heroValue} numberOfLines={1} adjustsFontSizeToFit>{money(total)}</Text>
          )}
          <Text style={s.heroNote}>{t('includesPlanned')}</Text>
        </GradientHero>

        {loading ? (
          <Card><Skeleton height={14} /><Skeleton height={12} width="70%" style={{ marginTop: 14 }} /><Skeleton height={12} width="50%" style={{ marginTop: 10 }} /></Card>
        ) : total > 0 ? (
          <>
            <View style={s.section}>
              <SectionTitle title={t('byType')} />
              <Card>
                <ShareBar
                  segments={[
                    { key: 'lessons', label: t('homeLessons'), value: lessons, color: colors.seriesLessons },
                    { key: 'household', label: t('household'), value: household, color: colors.seriesHousehold },
                  ]}
                  total={total}
                  money={money}
                />
              </Card>
            </View>

            <View style={s.section}>
              <SectionTitle title={t('actualVsPlanned')} />
              <Card>
                <TableRow cells={['', t('actual'), t('planned'), t('total')]} header />
                <TableRow cells={[t('lessonsShort'), money(report?.homeLessons.spentAmount ?? 0), money(report?.homeLessons.plannedRecurringAmount ?? 0), money(report?.homeLessons.totalAmount ?? 0)]} />
                <TableRow cells={[t('householdShort'), money(report?.household.spentAmount ?? 0), money(report?.household.plannedRecurringAmount ?? 0), money(report?.household.totalAmount ?? 0)]} />
              </Card>
            </View>

            {perChild.length ? (
              <View style={s.section}>
                <SectionTitle title={t('lessonsByChild')} />
                <Card><Bars data={perChild} color={colors.seriesLessons} money={money} /></Card>
              </View>
            ) : null}

            {householdItems.length ? (
              <View style={s.section}>
                <SectionTitle title={t('householdBySection')} />
                <Card><Bars data={householdItems} color={colors.seriesHousehold} money={money} /></Card>
              </View>
            ) : null}
          </>
        ) : (
          <Card><EmptyState icon="pie-chart-outline" title={t('noData')} body={t('noDataBody')} /></Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Part-to-whole: one stacked bar; the legend doubles as direct labels (value + share). */
function ShareBar({ segments, total, money }: { segments: { key: string; label: string; value: number; color: string }[]; total: number; money: (v: number) => string }) {
  const format = useFormat();
  const visible = segments.filter((segment) => segment.value > 0);
  const s = useStyles((c, d) => ({
    track: { height: 16, flexDirection: d.row, gap: 2, borderRadius: 4, overflow: 'hidden' as const },
    segment: { height: '100%' as const, borderRadius: 4 },
    legend: { flexDirection: d.row, alignItems: 'center' as const, gap: 10, marginTop: 14 },
    swatch: { width: 12, height: 12, borderRadius: 4 },
    label: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    value: { color: c.textSecondary, fontSize: 13, fontVariant: ['tabular-nums' as const] },
  }));
  return (
    <View>
      <View style={s.track} accessibilityRole="image" accessibilityLabel={visible.map((segment) => `${segment.label} ${money(segment.value)}`).join(', ')}>
        {visible.map((segment) => <View key={segment.key} style={[s.segment, { flex: segment.value, backgroundColor: segment.color }]} />)}
      </View>
      {segments.map((segment) => (
        <View key={segment.key} style={s.legend}>
          <View style={[s.swatch, { backgroundColor: segment.color }]} />
          <Text style={s.label}>{segment.label}</Text>
          <Text style={s.value}>{money(segment.value)} · {format.percent(segment.value / total)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Magnitude: single-hue horizontal bars growing from the start edge, values in text ink. */
function Bars({ data, color, money }: { data: BarDatum[]; color: string; money: (v: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  const s = useStyles((c, d) => ({
    labels: { flexDirection: d.row, alignItems: 'baseline' as const, gap: 8 },
    label: { flex: 1, color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    value: { color: c.textSecondary, fontSize: 13, fontVariant: ['tabular-nums' as const] },
    track: { height: 10, flexDirection: d.row, borderRadius: 4, backgroundColor: c.surfaceMuted, marginTop: 6 },
    bar: { height: '100%' as const, borderRadius: 4 },
  }));
  return (
    <View style={{ gap: 16 }}>
      {data.map((d) => (
        <View key={d.key} accessible accessibilityLabel={`${d.label} ${money(d.value)}`}>
          <View style={s.labels}>
            <Text style={s.label} numberOfLines={1}>{d.label}</Text>
            <Text style={s.value}>{money(d.value)}</Text>
          </View>
          <View style={s.track}>
            <View style={[s.bar, { width: `${Math.max((d.value / max) * 100, 2)}%`, backgroundColor: color }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function TableRow({ cells, header = false }: { cells: string[]; header?: boolean }) {
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, alignItems: 'center' as const, minHeight: 42, borderTopWidth: 1, borderTopColor: c.hairline },
    headerRow: { borderTopWidth: 0, minHeight: 30 },
    cell: { flex: 1, color: c.text, fontSize: 12, textAlign: d.end, fontVariant: ['tabular-nums' as const] },
    first: { flex: 0.8, textAlign: d.start, fontWeight: '700' as const },
    headerText: { color: c.muted, fontSize: 12, fontWeight: '600' as const },
  }));
  return (
    <View style={[s.row, header && s.headerRow]}>
      {cells.map((cell, index) => (
        <Text key={index} numberOfLines={1} style={[s.cell, index === 0 && s.first, header && s.headerText]}>{cell}</Text>
      ))}
    </View>
  );
}
