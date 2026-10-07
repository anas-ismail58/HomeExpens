import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDashboard, type Dashboard, type Expense, type PermissionKey } from '../../api';
import {
  Card,
  EmptyState,
  ExpenseRow,
  expenseLook,
  GradientHero,
  IconBubble,
  ListSkeleton,
  MonthSwitcher,
  SectionTitle,
  Skeleton,
  SmallButton,
  ToneCard,
  type IconName,
} from '../../components';
import { useNotifications } from '../../NotificationsContext';
import { PaymentAlertCard, PaymentRow } from '../../PaymentViews';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { useSubjectLabel } from '../../subjects';
import type { StringKey } from '../../i18n';
import type { Tone } from '../../theme';
import { shiftMonth, thisMonth, useMonthlyReport } from '../../useMonthlyReport';

const QUICK_ACTIONS: { kind: string; label: StringKey; icon: IconName; tone: Tone; needs: PermissionKey[] }[] = [
  { kind: 'lesson', label: 'newLesson', icon: 'school', tone: 'indigo', needs: ['SERVICE_LESSONS'] },
  { kind: 'household', label: 'householdExpense', icon: 'home', tone: 'amber', needs: ['SERVICE_HOUSEHOLD'] },
  { kind: 'tuition', label: 'monthlyFee', icon: 'repeat', tone: 'violet', needs: ['SERVICE_RECURRING', 'SERVICE_LESSONS'] },
];

export default function HomeScreen() {
  const { session } = useAuthedSession();
  const { t, colors, displayCurrency, setDisplayCurrency, rates } = usePreferences();
  const format = useFormat();
  const [month, setMonth] = useState(thisMonth);
  const { report, loading, refreshing, error, refresh } = useMonthlyReport(month);
  const currency = report?.currency ?? session.family.currency;
  const can = useCan();
  const { unreadCount } = useNotifications();
  const { dashboard, reload: reloadDashboard } = useDashboard(month);
  const [notice, setNotice] = useState('');
  const onPaid = (message: string) => {
    setNotice(message);
    void reloadDashboard();
  };
  const total = Number(report?.homeLessons.totalAmount ?? 0) + Number(report?.household.totalAmount ?? 0);

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40, gap: 18 },
    header: { flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
    avatar: { width: 46, height: 46, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
    avatarText: { color: c.primary, fontSize: 20, fontWeight: '800' as const },
    headerCopy: { flex: 1 },
    greeting: { color: c.muted, fontSize: 13, textAlign: d.start },
    family: { color: c.text, fontSize: 19, fontWeight: '800' as const, textAlign: d.start, marginTop: 2 },
    addButton: { width: 46, height: 46, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primary },
    bell: { width: 46, height: 46, borderRadius: 16, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.surface, borderWidth: 1, borderColor: c.hairline },
    bellBadge: { position: 'absolute' as const, top: 6, right: 6, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.danger, borderWidth: 2, borderColor: c.surface },
    bellBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' as const },
    notice: { color: c.success, fontSize: 13, fontWeight: '700' as const, textAlign: d.start },
    heroTop: { flexDirection: d.row, alignItems: 'center' as const, gap: 8 },
    currencyChip: { flexDirection: d.row, alignItems: 'center' as const, gap: 4, paddingHorizontal: 10, minHeight: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.2)' },
    currencyChipText: { color: c.heroText, fontSize: 12, fontWeight: '800' as const },
    heroLabel: { color: c.heroMuted, fontSize: 13, fontWeight: '600' as const, textAlign: d.start },
    heroAmount: { color: c.heroText, fontSize: 34, fontWeight: '800' as const, textAlign: d.start, marginTop: 6, fontVariant: ['tabular-nums' as const] },
    heroNote: { color: c.heroMuted, fontSize: 12, textAlign: d.start, marginTop: 4 },
    heroSplit: { flexDirection: d.row, gap: 10, marginTop: 18 },
    heroChip: { flex: 1, minWidth: 0, borderRadius: 14, padding: 12, backgroundColor: 'rgba(255,255,255,0.14)' },
    heroChipLabel: { color: c.heroMuted, fontSize: 12, textAlign: d.start },
    heroChipValue: { color: c.heroText, fontSize: 16, fontWeight: '700' as const, marginTop: 4, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    quickRow: { flexDirection: d.row, gap: 10 },
    quick: { flex: 1, minHeight: 96, padding: 12, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8 },
    quickLabel: { color: c.text, fontSize: 12, fontWeight: '700' as const, textAlign: 'center' as const },
    error: { color: c.danger, fontSize: 13, textAlign: d.start },
  }));

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void refresh(); void reloadDashboard(); }} tintColor={colors.primary} />}
      >
        <View style={s.header}>
          <View style={s.avatar}><Text style={s.avatarText}>{session.user.name.trim().charAt(0).toUpperCase() || 'م'}</Text></View>
          <View style={s.headerCopy}>
            <Text style={s.greeting}>{t('hello', { name: session.user.name })}</Text>
            <Text style={s.family} numberOfLines={1}>{session.family.name}</Text>
          </View>
          <Pressable onPress={() => router.push('/notifications')} style={({ pressed }) => [s.bell, pressed && { opacity: 0.8 }]} accessibilityLabel={unreadCount ? `${t('notifications')} · ${unreadCount}` : t('notifications')}>
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            {unreadCount > 0 ? <View style={s.bellBadge}><Text style={s.bellBadgeText}>{unreadCount > 9 ? '9+' : format.number(unreadCount)}</Text></View> : null}
          </Pressable>
          {can('ADD_EXPENSE') ? (
            <Pressable onPress={() => router.push('/create/lesson')} style={({ pressed }) => [s.addButton, pressed && { opacity: 0.8 }]} accessibilityLabel={t('addExpense')}>
              <Ionicons name="add" size={26} color={colors.primaryText} />
            </Pressable>
          ) : null}
        </View>

        {notice ? <Text style={s.notice}>{notice}</Text> : null}
        {dashboard ? [...dashboard.payments.overdue, ...dashboard.payments.dueToday].map((payment) => (
          <PaymentAlertCard key={payment.id} payment={payment} onChanged={onPaid} />
        )) : null}

        <MonthSwitcher month={month} onChange={(amount) => setMonth((m) => shiftMonth(m, amount))} />

        <GradientHero>
          <View style={s.heroTop}>
            <Text style={[s.heroLabel, { flex: 1 }]}>{t('monthTotal')}</Text>
            {rates ? (
              <Pressable
                onPress={() => setDisplayCurrency(displayCurrency === 'EGP' ? 'SAR' : 'EGP')}
                style={({ pressed }) => [s.currencyChip, pressed && { opacity: 0.8 }]}
                accessibilityLabel={t('displayCurrency')}
              >
                <Ionicons name="swap-horizontal" size={14} color={colors.heroText} />
                <Text style={s.currencyChipText}>{displayCurrency}</Text>
              </Pressable>
            ) : null}
          </View>
          {loading ? <Skeleton height={36} width="60%" style={{ marginTop: 8, backgroundColor: 'rgba(255,255,255,0.2)' }} /> : (
            <Text style={s.heroAmount} numberOfLines={1} adjustsFontSizeToFit>{format.money(total, currency)}</Text>
          )}
          <Text style={s.heroNote}>{t('actualPlusPlanned')}</Text>
          <View style={s.heroSplit}>
            <View style={s.heroChip}>
              <Text style={s.heroChipLabel}>{t('homeLessons')}</Text>
              <Text style={s.heroChipValue} numberOfLines={1}>{format.money(report?.homeLessons.totalAmount ?? 0, currency)}</Text>
            </View>
            <View style={s.heroChip}>
              <Text style={s.heroChipLabel}>{t('household')}</Text>
              <Text style={s.heroChipValue} numberOfLines={1}>{format.money(report?.household.totalAmount ?? 0, currency)}</Text>
            </View>
          </View>
        </GradientHero>

        {dashboard?.totals.balance != null || (dashboard && session.user.isAdmin) ? <BudgetCard dashboard={dashboard!} /> : null}

        {can('ADD_EXPENSE') && QUICK_ACTIONS.some((action) => action.needs.every(can)) ? <View style={s.quickRow}>
          {QUICK_ACTIONS.filter((action) => action.needs.every(can)).map((action) => (
            <Pressable key={action.kind} style={({ pressed }) => [{ flex: 1 }, pressed && { opacity: 0.8 }]} onPress={() => router.push(`/create/${action.kind}`)}>
              <ToneCard tone={action.tone} style={s.quick}>
                <IconBubble name={action.icon} color={colors.tones[action.tone].icon} background={colors.tones[action.tone].bubble} size={42} />
                <Text style={[s.quickLabel, { color: colors.tones[action.tone].fg }]}>{t(action.label)}</Text>
              </ToneCard>
            </Pressable>
          ))}
        </View> : null}

        {error ? <Text style={s.error}>{error}</Text> : null}

        <UpcomingPayments dashboard={dashboard} onChanged={onPaid} />

        <DailyChart key={month} month={month} expenses={report?.expenses ?? []} currency={currency} loading={loading} />

        {dashboard && dashboard.members.length > 1 ? <FamilyStrip dashboard={dashboard} /> : null}

        <View style={{ gap: 10 }}>
          <SectionTitle title={t('expenses')} count={report?.expenses.length ?? 0} />
          {loading ? (
            <Card padded={false} style={{ paddingHorizontal: 14 }}><ListSkeleton rows={3} /></Card>
          ) : report?.expenses.length ? (
            <GroupedExpenses expenses={report.expenses} currency={currency} />
          ) : (
            <Card><EmptyState icon="receipt-outline" title={t('noExpenses')} body={t('noExpensesBody')} /></Card>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/** Change over time: one column per day of the month, single hue; tap a column to read its value. */
function DailyChart({ month, expenses, currency, loading }: { month: string; expenses: Expense[]; currency: string; loading: boolean }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const days = useMemo(() => {
    const [year, monthNumber] = month.split('-').map(Number);
    const count = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const totals = Array.from({ length: count }, () => 0);
    for (const expense of expenses) {
      if (!expense.date.startsWith(month)) continue;
      totals[Number(expense.date.slice(8, 10)) - 1] += Number(expense.amount);
    }
    return totals;
  }, [expenses, month]);
  const max = Math.max(...days, 0);
  const busiest = max > 0 ? days.indexOf(max) : -1;
  const [selected, setSelected] = useState<number | null>(null);
  const active = selected ?? busiest;

  const s = useStyles((c, d) => ({
    readout: { color: c.text, fontSize: 14, fontWeight: '700' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    hint: { color: c.muted, fontSize: 12, textAlign: d.start, marginTop: 2 },
    plot: { height: 120, flexDirection: d.row, alignItems: 'flex-end' as const, gap: 2, marginTop: 14 },
    hit: { flex: 1, height: '100%' as const, justifyContent: 'flex-end' as const },
    bar: { width: '100%' as const, borderTopLeftRadius: 4, borderTopRightRadius: 4, minHeight: 2 },
    baseline: { height: 1, backgroundColor: c.border },
    axis: { flexDirection: d.row, justifyContent: 'space-between' as const, marginTop: 6 },
    axisText: { color: c.muted, fontSize: 11, fontVariant: ['tabular-nums' as const] },
    empty: { color: c.muted, fontSize: 13, textAlign: d.start, marginTop: 10 },
  }));

  return (
    <View style={{ gap: 10 }}>
      <SectionTitle title={t('dailySpending')} />
      <Card>
        {loading ? <Skeleton height={150} /> : max === 0 ? (
          <Text style={s.empty}>{t('noSpendingDays')}</Text>
        ) : (
          <>
            <Text style={s.readout}>{active >= 0 ? t('dayValue', { day: format.number(active + 1), amount: format.money(days[active], currency) }) : ''}</Text>
            <Text style={s.hint}>{t('dailySpendingHint')}</Text>
            <View style={s.plot}>
              {days.map((value, index) => (
                <Pressable
                  key={index}
                  style={s.hit}
                  onPress={() => setSelected(index)}
                  accessibilityLabel={t('dayValue', { day: index + 1, amount: format.money(value, currency) })}
                >
                  <View
                    style={[
                      s.bar,
                      {
                        height: value > 0 ? `${Math.max((value / max) * 100, 4)}%` : 2,
                        backgroundColor: value === 0 ? colors.hairline : index === active ? colors.primaryStrong : colors.seriesLessons,
                        opacity: value === 0 || index === active ? 1 : 0.55,
                      },
                    ]}
                  />
                </Pressable>
              ))}
            </View>
            <View style={s.baseline} />
            <View style={s.axis}>
              <Text style={s.axisText}>{format.number(1)}</Text>
              <Text style={s.axisText}>{format.number(Math.ceil(days.length / 2))}</Text>
              <Text style={s.axisText}>{format.number(days.length)}</Text>
            </View>
          </>
        )}
      </Card>
    </View>
  );
}

/**
 * The month's expenses split by title — each lesson subject and each household section gets its own
 * group with a count and subtotal, biggest first.
 */
function GroupedExpenses({ expenses, currency }: { expenses: Expense[]; currency: string }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const subjectLabel = useSubjectLabel();
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; title: string; sample: Expense; total: number; items: Expense[] }>();
    for (const expense of expenses) {
      const lesson = expense.subcategory?.key === 'home_tutoring';
      const key = lesson ? `lesson:${expense.subject ?? ''}` : `section:${expense.subcategory?.key ?? expense.category.key ?? ''}`;
      const title = lesson ? subjectLabel(expense.subject) || t('lessonsGroup') : format.name(expense.subcategory ?? expense.category);
      const group = map.get(key) ?? { key, title, sample: expense, total: 0, items: [] };
      group.total += Number(expense.amount);
      group.items.push(expense);
      map.set(key, group);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [expenses, format, subjectLabel, t]);

  const s = useStyles((c, d) => ({
    head: { flexDirection: d.row, alignItems: 'center' as const, gap: 10, paddingTop: 12, paddingBottom: 6 },
    title: { flex: 1, color: c.text, fontSize: 15, fontWeight: '800' as const, textAlign: d.start },
    count: { color: c.muted, fontSize: 12, textAlign: d.start, marginTop: 1 },
    total: { color: c.text, fontSize: 15, fontWeight: '800' as const, fontVariant: ['tabular-nums' as const] },
    rule: { height: 1, backgroundColor: c.hairline },
  }));

  return (
    <View style={{ gap: 12 }}>
      {groups.map((group) => (
        <Card key={group.key} padded={false} style={{ paddingHorizontal: 14 }}>
          <View style={s.head}>
            <IconBubble name={expenseLook(group.sample, colors).icon} color={expenseLook(group.sample, colors).color} background={expenseLook(group.sample, colors).soft} size={34} />
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>{group.title}</Text>
              <Text style={s.count}>{t('itemsCount', { count: format.number(group.items.length) })}</Text>
            </View>
            <Text style={s.total}>{format.money(group.total, currency)}</Text>
          </View>
          <View style={s.rule} />
          {group.items.map((expense, index) => (
            <ExpenseRow key={expense.id} expense={expense} currency={currency} last={index === group.items.length - 1} onPress={() => router.push(`/expense/${expense.id}`)} />
          ))}
        </Card>
      ))}
    </View>
  );
}

/** Payments, totals, members and unread count for the dashboard; reloads whenever Home is focused. */
function useDashboard(month: string) {
  const { call } = useAuthedSession();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const reload = useCallback(async () => {
    try {
      setDashboard(await call((s, r) => getDashboard(s, month, r)));
    } catch {
      // The rest of Home still works from the monthly report.
    }
  }, [call, month]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { dashboard, reload };
}

function UpcomingPayments({ dashboard, onChanged }: { dashboard: Dashboard | null; onChanged: (message: string) => void }) {
  const { t, colors } = usePreferences();
  const can = useCan();
  const upcoming = dashboard?.payments.upcoming.slice(0, 4) ?? [];
  const s = useStyles((c, d) => ({
    empty: { color: c.muted, fontSize: 13, lineHeight: 19, textAlign: d.start, flex: 1 },
    emptyRow: { flexDirection: d.row, alignItems: 'center' as const, gap: 12 },
  }));
  if (!can('VIEW_PAYMENTS') && !upcoming.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <SectionTitle
        title={t('upcomingPayments')}
        action={
          upcoming.length
            ? <SmallButton label={t('seeAll')} icon="calendar" onPress={() => router.push('/payments')} />
            : can('ADD_PAYMENT') ? <SmallButton label={t('add')} icon="add" onPress={() => router.push('/payment/new')} /> : undefined
        }
      />
      <Card padded={false} style={{ paddingHorizontal: 14, paddingVertical: upcoming.length ? 0 : 14 }}>
        {!dashboard ? <ListSkeleton rows={2} /> : upcoming.length ? upcoming.map((payment, index) => (
          <PaymentRow key={payment.id} payment={payment} last={index === upcoming.length - 1} onChanged={onChanged} />
        )) : (
          <View style={s.emptyRow}>
            <IconBubble name="calendar-outline" color={colors.tones.rose.icon} background={colors.tones.rose.from} />
            <Text style={s.empty}>{t('noPaymentsBody')}</Text>
          </View>
        )}
      </Card>
    </View>
  );
}

/** Salary − expenses = what is left this month (shown to the father and anyone he allows). */
function BudgetCard({ dashboard }: { dashboard: Dashboard }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const { session } = useAuthedSession();
  const balance = Number(dashboard.totals.balance ?? 0);
  const ratio = dashboard.totals.spentRatio;
  const over = balance < 0;
  const fg = colors.tones.teal.fg;
  const s = useStyles((c, d) => ({
    head: { flexDirection: d.row, alignItems: 'center' as const, gap: 10 },
    label: { fontSize: 12, fontWeight: '600' as const, textAlign: d.start },
    big: { fontSize: 24, fontWeight: '800' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    row: { flexDirection: d.row, gap: 10 },
    cell: { flex: 1, minWidth: 0, gap: 2 },
    value: { fontSize: 14, fontWeight: '800' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    track: { height: 8, borderRadius: 4, backgroundColor: c.surface, overflow: 'hidden' as const, flexDirection: d.row },
    fill: { height: '100%' as const, borderRadius: 4 },
    note: { fontSize: 12, fontWeight: '700' as const, textAlign: d.start },
  }));
  if (!dashboard.totals.hasSalary && !Number(dashboard.totals.income ?? 0)) {
    if (!session.user.isAdmin) return null;
    return (
      <Pressable onPress={() => router.push('/salary')} accessibilityRole="button">
        <ToneCard tone="teal" style={{ gap: 10 }}>
          <View style={s.head}>
            <IconBubble name="wallet" color={colors.tones.teal.icon} background={colors.tones.teal.bubble} size={42} />
            <View style={{ flex: 1 }}>
              <Text style={[s.value, { color: fg }]}>{t('noSalary')}</Text>
              <Text style={[s.label, { color: fg }]}>{t('noSalaryBody')}</Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-start' }}>
            <SmallButton label={t('setSalaryCta')} icon="add" onPress={() => router.push('/salary')} />
          </View>
        </ToneCard>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={() => router.push('/salary')} accessibilityRole="button" accessibilityLabel={t('salaryBudget')}>
      <ToneCard tone="teal" style={{ gap: 12 }}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { color: fg }]}>{t('remaining')}</Text>
            <Text style={[s.big, { color: over ? colors.danger : fg }]} numberOfLines={1}>{format.money(balance, dashboard.currency)}</Text>
          </View>
          <IconBubble name="wallet" color={colors.tones.teal.icon} background={colors.tones.teal.bubble} size={42} />
        </View>
        {ratio !== null ? (
          <>
            <View style={s.track}>
              <View style={[s.fill, { width: `${Math.min(ratio, 1) * 100}%`, backgroundColor: over ? colors.danger : ratio > 0.85 ? colors.tones.amber.icon : colors.tones.teal.icon }]} />
            </View>
            <Text style={[s.note, { color: over ? colors.danger : fg }]}>
              {over ? t('overBudget', { amount: format.money(Math.abs(balance), dashboard.currency) }) : t('spentOf', { percent: format.percent(ratio) })}
            </Text>
          </>
        ) : null}
        <View style={s.row}>
          <View style={s.cell}>
            <Text style={[s.label, { color: fg }]}>{t('income')}</Text>
            <Text style={[s.value, { color: fg }]} numberOfLines={1}>{format.money(dashboard.totals.income ?? 0, dashboard.currency)}</Text>
          </View>
          <View style={s.cell}>
            <Text style={[s.label, { color: fg }]}>{t('monthExpenses')}</Text>
            <Text style={[s.value, { color: fg }]} numberOfLines={1}>{format.money(dashboard.totals.expenses, dashboard.currency)}</Text>
          </View>
        </View>
      </ToneCard>
    </Pressable>
  );
}

function FamilyStrip({ dashboard }: { dashboard: Dashboard }) {
  const { t } = usePreferences();
  const s = useStyles((c, d) => ({
    row: { flexDirection: d.row, flexWrap: 'wrap' as const, gap: 14 },
    person: { alignItems: 'center' as const, gap: 6, width: 64 },
    avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: c.primarySoft },
    avatarText: { color: c.primary, fontSize: 18, fontWeight: '800' as const },
    name: { color: c.text, fontSize: 12, fontWeight: '600' as const, textAlign: 'center' as const },
    role: { color: c.muted, fontSize: 10, textAlign: 'center' as const },
  }));
  return (
    <View style={{ gap: 10 }}>
      <SectionTitle title={t('familyMembers')} count={dashboard.members.length} action={<SmallButton label={t('seeAll')} icon="people" onPress={() => router.push('/family')} />} />
      <Card>
        <View style={s.row}>
          {dashboard.members.map((member) => (
            <View key={member.id} style={s.person}>
              <View style={s.avatar}><Text style={s.avatarText}>{member.name.trim().charAt(0).toUpperCase()}</Text></View>
              <Text style={s.name} numberOfLines={1}>{member.name}</Text>
              <Text style={s.role} numberOfLines={1}>{t(`role${member.role}` as StringKey)}</Text>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}
