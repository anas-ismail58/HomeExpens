import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { getKidReport, type KidReport } from '../../api';
import { WithKidsBar as WithBottomBar } from '../../kidsShell';
import { Card, EmptyState, ListSkeleton, SectionTitle, SegmentedControl, ToneCard } from '../../components';
import { toDateOnly } from '../../formControls';
import type { StringKey } from '../../i18n';
import { PointEntryRow, PointsBars, Stars, useShortDate } from '../../kids';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession } from '../../SessionContext';
import { Text } from '../../typography';

type Period = 'week' | 'month';

function shift(date: string, period: Period, step: number) {
  const d = new Date(`${date}T00:00:00Z`);
  if (period === 'week') d.setUTCDate(d.getUTCDate() + 7 * step);
  else d.setUTCMonth(d.getUTCMonth() + step, 1);
  return d.toISOString().slice(0, 10);
}

export default function KidReportPage() {
  return (
    <WithBottomBar>
      <KidReportScreen />
    </WithBottomBar>
  );
}

function KidReportScreen() {
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const { call } = useAuthedSession();
  const { t, colors, rtl } = usePreferences();
  const format = useFormat();
  const shortDate = useShortDate();
  const [period, setPeriod] = useState<Period>('week');
  const [date, setDate] = useState(toDateOnly(new Date()));
  const [report, setReport] = useState<KidReport | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setReport(await call((s, r) => getKidReport(s, childId, period, date, r)));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    }
  }, [call, childId, period, date, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 40, gap: 16 },
    switcher: { flexDirection: d.row, alignItems: 'center' as const, justifyContent: 'space-between' as const },
    arrow: { width: 44, height: 44, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    range: { color: c.text, fontSize: 15, fontWeight: '700' as const, textAlign: 'center' as const, flex: 1 },
    grid: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 10 },
    stat: { flexGrow: 1, flexBasis: '45%' as const, minWidth: 0, gap: 4 },
    statLabel: { color: c.muted, fontSize: 12, fontWeight: '600' as const, textAlign: d.start },
    statValue: { color: c.text, fontSize: 18, fontWeight: '800' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    row: { flexDirection: d.row, justifyContent: 'space-between' as const, paddingVertical: 10 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowLabel: { color: c.textSecondary, fontSize: 14, textAlign: d.start },
    rowValue: { color: c.text, fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
    hint: { color: c.muted, fontSize: 13, textAlign: d.start, paddingVertical: 14 },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  // No going past the period that contains today.
  const isFuture = !report || report.end >= toDateOnly(new Date());

  const signed = (sign: string, value: number) => (value ? `${sign}${format.number(value)}` : format.number(0));

  const rows = (items: [StringKey, string][]) => items.map(([label, value], index) => (
    <View key={label} style={[s.row, index > 0 && s.divider]}>
      <Text style={s.rowLabel}>{t(label)}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
  ));

  return (
    <ScrollView showsVerticalScrollIndicator={false} style={s.screen} contentContainerStyle={s.page}>
      <Stack.Screen options={{ title: report ? `${t('kReports')} · ${report.child.name}` : t('kReports') }} />
      <SegmentedControl options={[{ value: 'week', label: t('kWeekly') }, { value: 'month', label: t('kMonthly') }]} value={period} onChange={(next) => { setPeriod(next); setDate(toDateOnly(new Date())); }} />
      <View style={s.switcher}>
        <Pressable style={s.arrow} onPress={() => setDate(shift(date, period, -1))} accessibilityLabel={t('rPrev')}>
          <Ionicons name={rtl ? 'chevron-forward' : 'chevron-back'} size={20} color={colors.primary} />
        </Pressable>
        <Text style={s.range}>{report ? (period === 'month' ? format.month(report.start.slice(0, 7)) : `${format.date(report.start)} – ${format.date(report.end)}`) : ' '}</Text>
        <Pressable style={[s.arrow, isFuture && { opacity: 0.35 }]} disabled={isFuture} onPress={() => setDate(shift(date, period, 1))} accessibilityLabel={t('rNext')}>
          <Ionicons name={rtl ? 'chevron-back' : 'chevron-forward'} size={20} color={colors.primary} />
        </Pressable>
      </View>

      {error ? <Text style={s.error}>{error}</Text> : null}
      {!report ? <Card><ListSkeleton rows={4} /></Card> : (
        <>
          <View style={s.grid}>
            <ToneCard tone="teal" style={s.stat}>
              <Text style={s.statLabel}>{t('rNet')}</Text>
              <Text style={s.statValue}>{report.points.net > 0 ? '+' : ''}{format.number(report.points.net)}</Text>
            </ToneCard>
            <ToneCard tone="amber" style={s.stat}>
              <Text style={s.statLabel}>{t('kRating')}</Text>
              <Stars value={report.stars} />
            </ToneCard>
            <ToneCard tone="indigo" style={s.stat}>
              <Text style={s.statLabel}>{t('rTasksApproved')}</Text>
              <Text style={s.statValue}>{format.number(report.counts.tasksApproved)}</Text>
            </ToneCard>
            <ToneCard tone="rose" style={s.stat}>
              <Text style={s.statLabel}>{t('rPenalties')}</Text>
              <Text style={s.statValue}>{format.number(report.points.penalties)}</Text>
            </ToneCard>
          </View>

          <View style={{ gap: 10 }}>
            <SectionTitle title={t('rDaily')} />
            <Card>
              <PointsBars data={report.days.map((d) => ({ key: d.date, earned: d.earned, lost: d.lost }))} labelOf={(key) => shortDate(key)} />
            </Card>
          </View>

          <View style={{ gap: 10 }}>
            <SectionTitle title={t('rPointsTitle')} />
            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              {rows([
                ['rBehavior', signed('+', report.points.behavior)],
                ['rTasks', signed('+', report.points.tasks)],
                ['rPenalties', signed('−', report.points.penalties)],
                ['rRewards', signed('−', report.points.rewards)],
                ['rConverted', signed('−', report.points.converted)],
              ])}
            </Card>
          </View>

          <View style={{ gap: 10 }}>
            <SectionTitle title={t('rMoneyTitle')} />
            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              {rows([
                ['rConverted', format.money(report.money.converted, report.currency)],
                ['rPaid', format.money(report.money.rewardsPaid, report.currency)],
                ['rAllowances', format.money(report.money.allowances, report.currency)],
                ['rMoneyPenalties', format.money(report.money.penalties, report.currency)],
              ])}
            </Card>
          </View>

          <View style={{ gap: 10 }}>
            <SectionTitle title={t('rTasksTitle')} />
            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              {rows([
                ['rTasksCreated', format.number(report.counts.tasksCreated)],
                ['rTasksDone', format.number(report.counts.tasksCompleted)],
                ['rTasksApproved', format.number(report.counts.tasksApproved)],
                ['rTasksOverdue', format.number(report.counts.tasksOverdue)],
                ['rDailyMissed', format.number(report.counts.dailyMissed ?? 0)],
              ])}
            </Card>
          </View>

          <View style={{ gap: 10 }}>
            <SectionTitle title={t('kHistory')} count={report.entries.length} />
            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              {report.entries.length
                ? report.entries.map((entry, index) => <PointEntryRow key={entry.id} entry={entry} currency={report.currency} first={index === 0} />)
                : <EmptyState icon="calendar-outline" title={t('kHistory')} body={t('kNoEntries')} />}
            </Card>
          </View>
        </>
      )}
    </ScrollView>
  );
}
