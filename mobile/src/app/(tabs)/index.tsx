import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text } from '../../typography';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDashboard, getPayments, type Dashboard, type Payment, type PermissionKey } from '../../api';
import { Card, ExpenseRow, IconBubble, SmallButton, ToneCard, type IconName } from '../../components';
import { ErrorCard, LoadingCards, RecentSection, StatCard, StatGrid, useInsights } from '../../insights';
import { useNotifications } from '../../NotificationsContext';
import { PaymentAlertCard, PaymentRow } from '../../PaymentViews';
import { useFormat, usePreferences, useStyles } from '../../preferences';
import { useAuthedSession, useCan } from '../../SessionContext';
import { FadeInView, GrowBar, PressableScale, useCountUp } from '../../motion';
import type { StringKey } from '../../i18n';
import type { Tone } from '../../theme';
import { thisMonth } from '../../useMonthlyReport';
import { CountrySwitcher } from '../../CountrySwitcher';
import { SectionTitle } from '../../components';

const QUICK_ACTIONS: { kind: string; label: StringKey; icon: IconName; tone: Tone; needs: PermissionKey[] }[] = [
  { kind: 'lesson', label: 'newLesson', icon: 'school', tone: 'indigo', needs: ['SERVICE_LESSONS'] },
  { kind: 'household', label: 'householdExpense', icon: 'home', tone: 'amber', needs: ['SERVICE_HOUSEHOLD'] },
  { kind: 'tuition', label: 'monthlyFee', icon: 'repeat', tone: 'violet', needs: ['SERVICE_RECURRING'] },
];

/**
 * Home = the family's dashboard: what needs attention, the month's key numbers, and only the latest few
 * records of each kind. Full lists live on their own pages ("View all" and the More menu).
 */
export default function HomeScreen() {
  const { session } = useAuthedSession();
  const { t, colors } = usePreferences();
  const format = useFormat();
  const can = useCan();
  const { unreadCount } = useNotifications();
  const { dashboard, reload: reloadDashboard } = useDashboard(thisMonth());
  const { data, error, loading, reload } = useInsights('month');
  const { unpaid, reload: reloadUnpaid } = useUnpaidPayments();
  const [notice, setNotice] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const currency = data?.currency ?? session.family.currency;
  const money = (value: string | number) => format.money(value, currency);
  const onPaid = (message: string) => {
    setNotice(message);
    void reloadDashboard();
    void reload();
    void reloadUnpaid();
  };

  const s = useStyles((c, d) => ({
    screen: { flex: 1, backgroundColor: c.background },
    page: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 40, gap: 18, width: '100%' as const, maxWidth: 980, alignSelf: 'center' as const },
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
    quickRow: { flexDirection: d.row, gap: 10 },
    quick: { flex: 1, minHeight: 88, padding: 12, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8 },
    quickLabel: { color: c.text, fontSize: 12, fontWeight: '700' as const, textAlign: 'center' as const },
    row: { minHeight: 58, flexDirection: d.row, alignItems: 'center' as const, gap: 12, paddingVertical: 8 },
    divider: { borderTopWidth: 1, borderTopColor: c.hairline },
    rowTitle: { color: c.text, fontSize: 14, fontWeight: '600' as const, textAlign: d.start },
    rowSub: { color: c.muted, fontSize: 12, marginTop: 2, textAlign: d.start },
    rowValue: { color: c.text, fontSize: 14, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
  }));

  const totals = data?.totals;

  return (
    <SafeAreaView style={s.screen} edges={['top', 'left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.page}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void Promise.all([reload(), reloadDashboard(), reloadUnpaid()]).finally(() => setRefreshing(false)); }} tintColor={colors.primary} />}
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

        <CountrySwitcher />

        {notice ? <Text style={s.notice}>{notice}</Text> : null}

        {/* What needs attention right now. */}
        {dashboard ? [...dashboard.payments.overdue, ...dashboard.payments.dueToday].slice(0, 3).map((payment) => (
          <PaymentAlertCard key={payment.id} payment={payment} onChanged={onPaid} />
        )) : null}

        {/* The most important money number: the salary and what's left of it. */}
        {dashboard && (dashboard.totals.balance != null || session.user.isAdmin) ? (
          <FadeInView index={0}><SalaryCard dashboard={dashboard} /></FadeInView>
        ) : null}

        <SectionTitle title={t('dashMonthTitle')} />
        {error && !data ? <ErrorCard message={error} onRetry={() => void reload()} /> : !totals ? <LoadingCards /> : (
          <StatGrid>
            {/* The month's spending counted like the salary card: actual + recurring planned this month. */}
            <StatCard
              icon="wallet"
              tone="indigo"
              label={t('dashFamilyExpenses')}
              value={money(dashboard?.totals.expenses ?? totals.expenses)}
              sub={Number(dashboard?.totals.planned ?? 0) > 0 ? t('includesPlannedAmount', { amount: money(dashboard!.totals.planned!) }) : undefined}
              onPress={() => router.push('/manage/transactions')}
              loading={loading && !data}
            />
            {totals.lessons != null ? (
              <StatCard
                icon="school"
                tone="violet"
                label={t('dashLessonCosts')}
                value={money(dashboard?.totals.lessons ?? totals.lessons)}
                sub={Number(dashboard?.totals.lessonsPlanned ?? 0) > 0 ? t('includesPlannedAmount', { amount: money(dashboard!.totals.lessonsPlanned!) }) : undefined}
                onPress={() => router.push('/manage/lessons')}
              />
            ) : null}
            <StatCard icon="checkmark-circle" tone="teal" label={t('dashPaid')} value={money(totals.paid.amount)} sub={t('dashPaymentsCount', { count: format.number(totals.paid.count) })} onPress={() => router.push('/payments')} />
            <StatCard
              icon="alert-circle"
              tone="rose"
              label={t('dashUnpaid')}
              value={money(totals.unpaid.amount)}
              sub={totals.overdue.count ? `${t('dashOverdue')}: ${money(totals.overdue.amount)}` : t('dashPaymentsCount', { count: format.number(totals.unpaid.count) })}
              onPress={() => router.push('/payments')}
            />
            {totals.upcomingLessons != null ? <StatCard icon="calendar" tone="amber" label={t('dashUpcomingLessons')} value={format.number(totals.upcomingLessons)} sub={t('dashNext7Days')} onPress={() => router.push('/manage/lessons')} /> : null}
          </StatGrid>
        )}

        {can('ADD_EXPENSE') && QUICK_ACTIONS.some((action) => action.needs.every(can)) ? <View style={s.quickRow}>
          {QUICK_ACTIONS.filter((action) => action.needs.every(can)).map((action) => (
            <PressableScale key={action.kind} style={{ flex: 1 }} onPress={() => router.push(`/create/${action.kind}`)}>
              <ToneCard tone={action.tone} style={s.quick}>
                <IconBubble name={action.icon} color={colors.tones[action.tone].icon} background={colors.tones[action.tone].bubble} size={38} />
                <Text style={[s.quickLabel, { color: colors.tones[action.tone].fg }]}>{t(action.label)}</Text>
              </ToneCard>
            </PressableScale>
          ))}
        </View> : null}

        {/* Payments not paid yet, soonest first; each can be paid right here. */}
        {can('VIEW_PAYMENTS') || unpaid.length ? (
          <View style={{ gap: 10 }}>
            <SectionTitle title={t('unpaidPayments')} count={unpaid.length} action={<SmallButton label={t('viewAll')} icon="list" onPress={() => router.push('/payments')} />} />
            <Card padded={false} style={{ paddingHorizontal: 14 }}>
              {unpaid.length ? unpaid.slice(0, 5).map((payment, index) => (
                <PaymentRow key={payment.id} payment={payment} last={index === Math.min(unpaid.length, 5) - 1} onChanged={onPaid} />
              )) : <Text style={s.rowSub}>{t('noUnpaidPayments')}</Text>}
            </Card>
          </View>
        ) : null}

        {data ? (
          <RecentSection title={t('recentTransactions')} href="/manage/transactions" empty={t('noRecentTransactions')}>
            {data.recent.transactions.map((expense, index) => (
              <ExpenseRow key={expense.id} expense={expense} currency={currency} last={index === data.recent.transactions.length - 1} onPress={() => router.push(`/expense/${expense.id}`)} />
            ))}
          </RecentSection>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function useDashboard(month: string) {
  const { call } = useAuthedSession();
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const latest = useRef(0);
  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const next = await call((s, r) => getDashboard(s, month, r));
      // Ignore a slower answer for a month that's no longer showing.
      if (request === latest.current) setDashboard(next);
    } catch {
      // The rest of Home still works from the monthly report.
    }
  }, [call, month]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { dashboard, reload };
}

/**
 * Total payments with a paid / still-to-pay split. Part-to-whole of two values → one stacked bar
 * (2px surface gap between the parts, rounded ends), each part labelled with amount and share so the
 * colour is never the only cue. Reloads whenever the dashboard does (e.g. after "Pay now").
 */

function SalaryCard({ dashboard }: { dashboard: Dashboard }) {
  const { t, colors } = usePreferences();
  const format = useFormat();
  const { session } = useAuthedSession();
  const balance = Number(dashboard.totals.balance ?? 0);
  // What will be left once this month's remaining payments are paid too.
  // From the server: only what is due this month and not already in the spending (no double counting).
  const afterPaying = dashboard.totals.afterPaying != null && Number(dashboard.totals.stillToPay) > 0 ? Number(dashboard.totals.afterPaying) : null;
  const ratio = dashboard.totals.spentRatio;
  const over = balance < 0;
  const fg = colors.tones.teal.fg;
  const shownBalance = useCountUp(balance);
  const s = useStyles((c, d) => ({
    head: { flexDirection: d.row, alignItems: 'center' as const, gap: 10 },
    label: { fontSize: 12, fontWeight: '600' as const, textAlign: d.start },
    big: { fontSize: 24, fontWeight: '800' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    row: { flexDirection: d.row, gap: 10 },
    cell: { flex: 1, minWidth: 0, gap: 2 },
    value: { fontSize: 14, fontWeight: '800' as const, textAlign: d.start, fontVariant: ['tabular-nums' as const] },
    track: { height: 8, borderRadius: 4, backgroundColor: c.surface, overflow: 'hidden' as const, flexDirection: d.row },
    note: { fontSize: 12, fontWeight: '700' as const, textAlign: d.start },
  }));
  if (!dashboard.totals.hasSalary && !Number(dashboard.totals.income ?? 0)) {
    if (!session.user.isAdmin) return null;
    return (
      <View>
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
      </View>
    );
  }
  return (
    <PressableScale onPress={() => router.push('/salary')} accessibilityRole="button" accessibilityLabel={t('salaryBudget')}>
      <ToneCard tone="teal" style={{ gap: 12 }}>
        <View style={s.head}>
          <IconBubble name="wallet" color={colors.tones.teal.icon} background={colors.tones.teal.bubble} size={42} />
          <View style={{ flex: 1 }}>
            <Text style={[s.label, { color: fg }]}>{t('salary')}</Text>
            <Text style={[s.value, { color: fg }]} numberOfLines={1}>{format.money(dashboard.totals.income ?? 0, dashboard.currency)}</Text>
          </View>
        </View>
        <View>
          <Text style={[s.label, { color: fg }]}>{t('remainingSalary')}</Text>
          <Text style={[s.big, { color: over ? colors.danger : fg }]} numberOfLines={1}>{format.money(shownBalance, dashboard.currency)}</Text>
        </View>
        {ratio !== null ? (
          <>
            <View style={s.track}>
              <GrowBar share={ratio} color={over ? colors.danger : ratio > 0.85 ? colors.tones.amber.icon : colors.tones.teal.icon} />
            </View>
            <Text style={[s.note, { color: over ? colors.danger : fg }]}>
              {over ? t('overBudget', { amount: format.money(Math.abs(balance), dashboard.currency) }) : t('spentOf', { percent: format.percent(ratio) })}
            </Text>
          </>
        ) : null}
        <View style={s.row}>
          <View style={s.cell}>
            <Text style={[s.label, { color: fg }]}>{t('monthExpenses')}</Text>
            <Text style={[s.value, { color: fg }]} numberOfLines={1}>{format.money(dashboard.totals.expenses, dashboard.currency)}</Text>
          </View>
          {/* This month's payments (unpaid cycles) come off the salary too. */}
          {Number(dashboard.totals.payments ?? 0) > 0 ? (
            <View style={s.cell}>
              <Text style={[s.label, { color: fg }]}>{t('monthPayments')}</Text>
              <Text style={[s.value, { color: fg }]} numberOfLines={1}>{format.money(dashboard.totals.payments!, dashboard.currency)}</Text>
            </View>
          ) : null}
          {/* Own savings moved to the vault are taken off the balance; the amount stays hidden here. */}
          {dashboard.totals.savedToVault ? (
            <View style={s.cell}>
              <Text style={[s.label, { color: fg }]}>{t('savedToVault')}</Text>
              <Text style={[s.value, { color: fg }]} numberOfLines={1}>••••••</Text>
            </View>
          ) : null}
          {afterPaying !== null ? (
            <View style={s.cell}>
              <Text style={[s.label, { color: fg }]}>{t('afterPaying')}</Text>
              <Text style={[s.value, { color: afterPaying < 0 ? colors.danger : fg }]} numberOfLines={1}>{format.money(afterPaying, dashboard.currency)}</Text>
            </View>
          ) : null}
        </View>
      </ToneCard>
    </PressableScale>
  );
}

/** Payments still to pay (any not paid yet), soonest due first. */
function useUnpaidPayments() {
  const { call } = useAuthedSession();
  const [unpaid, setUnpaid] = useState<Payment[]>([]);
  const reload = useCallback(async () => {
    try {
      const list = await call((s, r) => getPayments(s, r));
      setUnpaid(list.filter((p) => p.state === 'ACTIVE' && p.status !== 'PAID').sort((a, b) => a.dueAt.localeCompare(b.dueAt)));
    } catch {
      // The section just stays empty; the payments page shows the error.
    }
  }, [call]);
  useFocusEffect(useCallback(() => { void reload(); }, [reload]));
  return { unpaid, reload };
}

